//#region Imports
import type { Express, Request, Response } from "express"

import { hashPassword, verifyPassword } from "@/auth/password"
import { randomIdentityColor } from "@/auth/identity"
import {
  clearSessionCookie,
  createSessionForUser,
  destroySession,
  readSessionToken,
  resolveSessionUser,
  setSessionCookie,
} from "@/auth/session"
import {
  validateEmail,
  validatePassword,
  validateUsername,
} from "@/auth/validation"
import {
  createUser,
  emailExists,
  findUserByEmail,
} from "@/db/userRepository"

import type { User } from "@/db/userRepository"
//#endregion

//#region Helpers
// The user shape sent to the client — exactly the public columns, never the
// hash. `isGuest: false` mirrors the guest identity shape the presence system
// uses, so the frontend can treat both uniformly.
function publicUser(user: User) {
  return {
    id: user.id,
    email: user.email,
    username: user.username,
    color: user.color,
    isGuest: false as const,
  }
}
//#endregion

//#region Routes
export default function configureAuthRoutes(app: Express): void {
  // --- Register --------------------------------------------------------------
  app.post("/api/auth/register", async (req: Request, res: Response) => {
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

    // Check-then-insert races on the UNIQUE(email) constraint, so treat a
    // unique-violation from the insert as the authoritative "taken" too.
    if (await emailExists(email.value)) {
      return res.status(409).json({ error: "That email is already registered." })
    }

    try {
      const user = await createUser({
        email: email.value,
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
      console.error("register failed:", error)
      return res.status(500).json({ error: "Could not create account." })
    }
  })

  // --- Login -----------------------------------------------------------------
  app.post("/api/auth/login", async (req: Request, res: Response) => {
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

    const record = await findUserByEmail(email.value)
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
    await destroySession(readSessionToken(req))
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
