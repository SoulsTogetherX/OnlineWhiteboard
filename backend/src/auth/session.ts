//#region Imports
import { createHash, randomBytes } from "node:crypto"

import type { Request, Response } from "express"

import {
  createSession,
  deleteSession,
  findUserBySessionHash,
} from "@/db/sessionRepository"
import { SESSION_COOKIE, parseCookies } from "./cookies"

import type { User } from "@/db/userRepository"
//#endregion

//#region Constants
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000 // 30 days
const IS_PROD = process.env.NODE_ENV === "production"
//#endregion

//#region Token hashing
// The cookie carries a raw random token; the database stores only its SHA-256
// hash. A plain hash (no salt) is correct here, unlike for passwords: the token
// is 256 bits of randomness, so there is nothing to brute-force and no need to
// slow the lookup down. Hashing it just means a stolen database dump can't be
// replayed as live sessions.
function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex")
}
//#endregion

//#region Session lifecycle
export async function createSessionForUser(
  userId: string,
): Promise<{ token: string; expiresAt: Date }> {
  const token = randomBytes(32).toString("base64url")
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS)
  await createSession({ tokenHash: hashToken(token), userId, expiresAt })
  return { token, expiresAt }
}

// Resolves a raw cookie token to its user, or null if there's no token, no
// matching session, or the session has expired.
export async function resolveSessionUser(
  token: string | undefined,
): Promise<User | null> {
  if (!token) {
    return null
  }
  return findUserBySessionHash(hashToken(token))
}

export async function destroySession(token: string | undefined): Promise<void> {
  if (!token) {
    return
  }
  await deleteSession(hashToken(token))
}
//#endregion

//#region Cookie I/O (Express)
export function setSessionCookie(
  res: Response,
  token: string,
  expiresAt: Date,
): void {
  res.cookie(SESSION_COOKIE, token, {
    httpOnly: true, // unreadable from JS — blunts XSS session theft
    sameSite: "lax", // not sent on cross-site requests — blunts CSRF
    secure: IS_PROD, // HTTPS-only in prod; off in dev so http://localhost works
    path: "/", // sent for both /api and the /ws upgrade
    expires: expiresAt,
  })
}

export function clearSessionCookie(res: Response): void {
  res.clearCookie(SESSION_COOKIE, {
    httpOnly: true,
    sameSite: "lax",
    secure: IS_PROD,
    path: "/",
  })
}

export function readSessionToken(req: Request): string | undefined {
  return parseCookies(req.headers.cookie)[SESSION_COOKIE]
}
//#endregion
