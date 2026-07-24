//#region Why this exists
// The link tokens for email verification and password reset are, like session
// tokens, high-entropy random strings that the database only ever stores as a
// SHA-256 hash. This module owns the raw<->hash boundary and the policy around
// it (lifetimes, the anti-spam cooldown), so the routes deal in "issue a
// verification token for this user" / "redeem this token" rather than in crypto
// and table rows.
//
// It mirrors session.ts deliberately: one place turns a raw token into its
// stored id, so the two flows can't drift into two hashing schemes.
//#endregion

//#region Imports
import { createHash, randomBytes } from "node:crypto"

import {
  consumeAuthToken,
  createAuthToken,
  deleteAuthTokensForUserKind,
  latestAuthTokenIssuedAt,
} from "@/db/authTokenRepository"

import type { AuthTokenKind } from "@/db/authTokenRepository"
//#endregion

//#region Constants
// Verification links are long-lived (a day) because people check email late;
// reset links are short (an hour) because a live password-reset link is a
// standing key to the account and should not linger. Both are single-use
// regardless of the window.
const TTL_MS: Record<AuthTokenKind, number> = {
  email_verify: 24 * 60 * 60 * 1000,
  password_reset: 60 * 60 * 1000,
}

// Per-account, per-kind cooldown between emails. This is the control that stops
// the send endpoints being used to flood a victim's inbox: even with the per-IP
// rate limit bypassed by a botnet, a given address gets at most one mail a
// minute. It is deliberately short enough that a real "I didn't get it, resend"
// still works within a reasonable wait.
const RESEND_COOLDOWN_MS = 60 * 1000
//#endregion

//#region Token hashing
// Same construction as hashSessionToken: a plain unsalted SHA-256, correct here
// because the token is 256 bits of randomness with nothing to brute-force. The
// hash exists only so a database dump holds values that cannot be presented as
// live links.
function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex")
}
//#endregion

//#region Issue / redeem
export type IssueResult =
  | { ok: true; token: string }
  // Refused because a token of this kind was issued within the cooldown window.
  // The caller returns its usual generic success either way — throttling must not
  // become a signal an attacker can read — but skips actually sending an email.
  | { ok: false; throttled: true }

// Mints a fresh single-use token for a user, unless one was issued within the
// cooldown. On success it first retires any older tokens of the same kind, so
// only the newest link works, then stores the new one's hash and hands the raw
// token back for the caller to put in the emailed link.
export async function issueAuthToken(
  userId: string,
  kind: AuthTokenKind,
): Promise<IssueResult> {
  const last = await latestAuthTokenIssuedAt(userId, kind)
  if (last && Date.now() - last.getTime() < RESEND_COOLDOWN_MS) {
    return { ok: false, throttled: true }
  }

  // Retire older tokens of this kind before minting the new one, so a user who
  // requests twice finds only the latest link live.
  await deleteAuthTokensForUserKind(userId, kind)

  const token = randomBytes(32).toString("base64url")
  const expiresAt = new Date(Date.now() + TTL_MS[kind])
  await createAuthToken({ tokenHash: hashToken(token), userId, kind, expiresAt })
  return { ok: true, token }
}

// Redeems a raw token, returning the user id it belonged to or null if it is
// unknown, of the wrong kind, or expired. Single-use: a successful redeem
// deletes the row (see consumeAuthToken), so the same link cannot be replayed.
export async function redeemAuthToken(
  token: string,
  kind: AuthTokenKind,
): Promise<string | null> {
  if (typeof token !== "string" || token.length === 0 || token.length > 512) {
    return null
  }
  return consumeAuthToken(hashToken(token), kind)
}
//#endregion
