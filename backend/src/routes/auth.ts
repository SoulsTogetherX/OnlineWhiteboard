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
import {
  closeSocketsForSession,
  closeSocketsForUser,
} from "@/sockets/sessionRegistry"
import {
  validateEmail,
  validatePassword,
  validateUsername,
} from "@/auth/validation"
import {
  createUser,
  deleteUser,
  emailIndexExists,
  findEmailCiphertext,
  findUserByEmailIndex,
  updateUsername,
} from "@/db/userRepository"
import { deleteAllSessionsForUser } from "@/db/sessionRepository"
import {
  decryptEmail,
  emailBlindIndex,
  encryptEmail,
  newUserId,
} from "@/auth/emailCrypto"
import { issueAuthToken, redeemAuthToken } from "@/auth/authToken"
import {
  sendPasswordResetEmail,
  sendVerificationEmail,
} from "@/auth/mailer"
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

// The email-out endpoints are the ones an attacker abuses to flood an inbox, so
// they are limited per IP here IN ADDITION to the per-account cooldown enforced
// in authToken (the cooldown protects one victim across many IPs; this limits
// one IP across many victims). Redeeming endpoints are limited too — a token is
// 256 bits so it can't be brute-forced, but an unmetered endpoint that hits the
// database on every call is still worth bounding.
const sendVerificationLimiter = rateLimit({
  name: "send-verification",
  windowMs: 60 * 60_000,
  max: 5,
})
const requestResetLimiter = rateLimit({
  name: "request-password-reset",
  windowMs: 15 * 60_000,
  max: 5,
})
const resetPasswordLimiter = rateLimit({
  name: "reset-password",
  windowMs: 15 * 60_000,
  max: 10,
})
const verifyEmailLimiter = rateLimit({
  name: "verify-email",
  windowMs: 15 * 60_000,
  max: 30,
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
    // Whether the account's email has been confirmed. Safe to expose — it is a
    // property of the account the caller already owns, not a cross-account
    // identifier — and the Account tab renders it as a verified/unverified badge.
    emailVerified: user.emailVerified,
  }
}

// A small self-contained HTML page for the verify-email GET, which is opened
// directly in a browser from an email client rather than fetched by the SPA.
// Deliberately inline and asset-free so it satisfies the app's strict CSP with
// no external stylesheet or script, and offers one link back into the app.
function verifyResultPage(ok: boolean): string {
  const site = (process.env.PUBLIC_SITE_URL ?? "http://localhost:5173").replace(
    /\/+$/,
    "",
  )
  const title = ok ? "Email verified" : "Link invalid or expired"
  const body = ok
    ? "Your email address is confirmed. You can close this tab and return to " +
      "Online Whiteboard."
    : "This verification link is no longer valid — it may have expired or " +
      "already been used. You can request a new one from your account."
  return (
    `<!doctype html><html lang="en"><head><meta charset="utf-8">` +
    `<meta name="viewport" content="width=device-width, initial-scale=1">` +
    `<title>${title} · Online Whiteboard</title>` +
    `<style>body{margin:0;min-height:100vh;display:grid;place-items:center;` +
    `font-family:system-ui,sans-serif;background:#111;color:#eee}` +
    `main{max-width:28rem;padding:2rem;text-align:center}` +
    `h1{font-size:1.3rem;margin:0 0 .75rem}p{line-height:1.5;color:#bbb}` +
    `a{display:inline-block;margin-top:1.25rem;color:#4da3ff}</style></head>` +
    `<body><main><h1>${title}</h1><p>${body}</p>` +
    `<a href="${site}">Back to Online Whiteboard</a></main></body></html>`
  )
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

    // Length-bound BEFORE hashing. Register caps at 200 with a comment calling a
    // megabyte-long "password" a cheap denial of service; login had no bound, so
    // with a 2 MB JSON limit that was a 2 MB input to scrypt on the endpoint an
    // attacker actually hits. Same generic reply, so it stays non-enumerable.
    if (!email.ok || typeof password !== "string" || password.length > 200) {
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

  // --- Change display name ---------------------------------------------------
  // The account tab's rename. Authorisation is the session itself: there is no
  // user id in the request, so this can only ever rename the caller — an id
  // parameter would be an invitation to rename somebody else.
  app.patch("/api/auth/me", async (req: Request, res: Response) => {
    const current = await resolveSessionUser(readSessionToken(req))
    if (!current) {
      return res.status(401).json({ error: "Not signed in." })
    }

    // The same validator the register form uses, so a name that could not be
    // registered cannot be renamed into either.
    const username = validateUsername(req.body?.username)
    if (!username.ok) {
      return res.status(400).json({ error: username.error })
    }

    const updated = await updateUsername(current.id, username.value)
    if (!updated) {
      return res.status(404).json({ error: "Account not found." })
    }
    return res.status(200).json({ user: publicUser(updated) })
  })

  // --- Delete account --------------------------------------------------------
  // Irreversible, and again scoped to the caller by the session alone.
  //
  // The order matters. Sockets are closed BEFORE the row goes, because an open
  // socket was authenticated once at its upgrade and would otherwise keep acting
  // as a user who no longer exists. Deleting first would leave a live connection
  // holding a dangling identity.
  app.delete("/api/auth/me", async (req: Request, res: Response) => {
    const token = readSessionToken(req)
    const current = await resolveSessionUser(token)
    if (!current) {
      return res.status(401).json({ error: "Not signed in." })
    }

    // EVERY session's sockets, not just this one's. The other sessions' rows
    // cascade away with the user below, but their sockets would otherwise stay
    // open holding a userId for a row that no longer exists, until the 30-minute
    // revalidation sweep noticed.
    closeSocketsForUser(current.id)

    // Everything hanging off the id — sessions, saved colours, memberships
    // (ownership included) — goes with it via the schema's own ON DELETE rules.
    // Rooms they created survive, unowned; see deleteUser.
    const deleted = await deleteUser(current.id)
    if (!deleted) {
      return res.status(404).json({ error: "Account not found." })
    }

    clearSessionCookie(res)
    return res.status(204).end()
  })
}
//#endregion
