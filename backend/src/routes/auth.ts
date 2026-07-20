//#region Imports
import type { Express, Request, Response } from "express"

import { hashPassword, verifyPassword } from "@/auth/password"
import { randomIdentityColor } from "@/auth/identity"
import {
  clearSessionCookie,
  createSessionForUser,
  destroySession,
  hashSessionToken,
  readSessionToken,
  resolveSessionUser,
  setSessionCookie,
} from "@/auth/session"
import { closeSocketsForSession } from "@/sockets/sessionRegistry"
import {
  validateEmail,
  validatePassword,
  validateUsername,
} from "@/auth/validation"
import {
  createUser,
  emailIndexExists,
  findUserByEmailIndex,
} from "@/db/userRepository"
import {
  emailBlindIndex,
  encryptEmail,
  newUserId,
} from "@/auth/emailCrypto"
import { checkPasswordBreached } from "@/auth/breachedPassword"
import { rateLimit } from "@/security/rateLimit"

import type { User } from "@/db/userRepository"
//#endregion

//#region Rate limiters
// Tight limits on the two endpoints an attacker hammers: login (password
// guessing / credential stuffing) and register (account-spam and email
// enumeration). Per IP.
const loginLimiter = rateLimit({ name: "login", windowMs: 15 * 60_000, max: 10 })
const registerLimiter = rateLimit({
  name: "register",
  windowMs: 60 * 60_000,
  max: 5,
})
//#endregion

//#region Helpers
// The user shape sent to the client — exactly the public columns, never the
// hash. `isGuest: false` mirrors the guest identity shape the presence system
// uses, so the frontend can treat both uniformly.
//
// No email. The client only ever SENDS an address (the login/register forms);
// nothing displays it back. Not returning it means the address never travels
// beyond the request that created the account, so it cannot leak through an API
// response, a client-side cache, or a browser devtools session.
function publicUser(user: User) {
  return {
    id: user.id,
    username: user.username,
    color: user.color,
    isGuest: false as const,
  }
}
//#endregion

//#region Routes
export default function configureAuthRoutes(app: Express): void {
  // --- Register --------------------------------------------------------------
  app.post("/api/auth/register", registerLimiter, async (req: Request, res: Response) => {
    const email = validateEmail(req.body?.email)
    if (!email.ok) {
      return res.status(400).json({ error: email.error })
    }
    const username = validateUsername(req.body?.username)
    if (!username.ok) {
      return res.status(400).json({ error: username.error })
    }
    const password = validatePassword(req.body?.password)
    if (!password.ok) {
      return res.status(400).json({ error: password.error })
    }

    // Screen against known-breached credentials (NIST SP 800-63B). This is the
    // control that stops credential stuffing — the attack that took ~14,000
    // 23andMe accounts and cascaded to millions. A reused password can be
    // perfectly strong and still already public.
    const breach = await checkPasswordBreached(password.value)
    if (breach.breached) {
      return res.status(400).json({
        error:
          `That password has appeared in ${breach.count.toLocaleString()} known data ` +
          `breaches. It is not weak — it is public. Please choose a different one.`,
      })
    }

    // The address is turned into a blind index once and the plaintext is used
    // only to build the ciphertext below — it is never stored, logged, or
    // compared directly.
    const emailIndex = await emailBlindIndex(email.value)

    // Check-then-insert races on the UNIQUE(email_index) constraint, so treat a
    // unique-violation from the insert as the authoritative "taken" too.
    if (await emailIndexExists(emailIndex)) {
      return res.status(409).json({ error: "That email is already registered." })
    }

    try {
      // The id is generated here, before the insert, because it is the AAD that
      // binds this row's ciphertext to this row.
      const id = newUserId()
      const user = await createUser({
        id,
        emailIndex,
        emailCiphertext: encryptEmail(email.value, id),
        username: username.value,
        passwordHash: await hashPassword(password.value),
        color: randomIdentityColor(),
      })

      const { token, expiresAt } = await createSessionForUser(user.id)
      setSessionCookie(res, token, expiresAt)
      return res.status(201).json({ user: publicUser(user) })
    } catch (error) {
      // 23505 = unique_violation: the race above resolved against us.
      if ((error as { code?: string }).code === "23505") {
        return res
          .status(409)
          .json({ error: "That email is already registered." })
      }
      // Log only the message/code, never the error object — a database error can
      // carry the failing query's parameters (email, password hash), which
      // should not land in server logs.
      const e = error as { message?: string; code?: string }
      console.error(`register failed: ${e.code ?? ""} ${e.message ?? ""}`.trim())
      return res.status(500).json({ error: "Could not create account." })
    }
  })

  // --- Login -----------------------------------------------------------------
  app.post("/api/auth/login", loginLimiter, async (req: Request, res: Response) => {
    const email = validateEmail(req.body?.email)
    const password = req.body?.password

    // A generic error for both "no such email" and "wrong password" so the
    // endpoint can't be used to discover which emails have accounts. We still
    // run verifyPassword against a dummy hash when the user is missing, so the
    // response time doesn't leak account existence either.
    const invalid = () =>
      res.status(401).json({ error: "Incorrect email or password." })

    if (!email.ok || typeof password !== "string") {
      return invalid()
    }

    const record = await findUserByEmailIndex(await emailBlindIndex(email.value))
    if (!record) {
      // Constant-work path: hash a throwaway so timing matches the found case.
      await hashPassword(password)
      return invalid()
    }

    const ok = await verifyPassword(password, record.passwordHash)
    if (!ok) {
      return invalid()
    }

    const { token, expiresAt } = await createSessionForUser(record.id)
    setSessionCookie(res, token, expiresAt)
    return res.status(200).json({ user: publicUser(record) })
  })

  // --- Logout ----------------------------------------------------------------
  app.post("/api/auth/logout", async (req: Request, res: Response) => {
    const token = readSessionToken(req)
    await destroySession(token)

    // Disconnect any WebSocket still authenticated by this session. Deleting
    // the session row only makes future HTTP requests anonymous; an open socket
    // was authenticated once at its upgrade and would otherwise keep acting as
    // the logged-in user until the tab closed. On a shared computer that means
    // "log out" did not actually end access.
    if (token) {
      const closed = closeSocketsForSession(hashSessionToken(token))
      if (closed > 0) {
        console.log(`logout: closed ${closed} socket(s) for the ended session`)
      }
    }

    clearSessionCookie(res)
    return res.status(204).end()
  })

  // --- Current user ----------------------------------------------------------
  // The frontend calls this on load to learn whether there's a live session.
  app.get("/api/auth/me", async (req: Request, res: Response) => {
    const user = await resolveSessionUser(readSessionToken(req))
    if (!user) {
      return res.status(200).json({ user: null })
    }
    return res.status(200).json({ user: publicUser(user) })
  })
}
//#endregion
