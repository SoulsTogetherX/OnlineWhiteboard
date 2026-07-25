//#region Imports
import { db } from "./pool"

import type { AuthTokensTable } from "./schema"
//#endregion

//#region Types
export type AuthTokenKind = AuthTokensTable["kind"]
//#endregion

//#region Repository
// The token layer behind email verification and password reset. Every function
// takes the token's HASH, never the raw token — the raw value lives only in the
// emailed link, and this layer (like sessionRepository) only ever sees the hash
// the database stores. Hashing happens one layer up, in auth/authToken.ts, so
// there is a single implementation of "raw token -> stored id".

// Issues a token. The caller has already invalidated any prior tokens of this
// kind (see deleteAuthTokensForUserKind) and hashed the raw value.
export async function createAuthToken(input: {
  tokenHash: string
  userId: string
  kind: AuthTokenKind
  expiresAt: Date
}): Promise<void> {
  await db
    .insertInto("auth_tokens")
    .values({
      id: input.tokenHash,
      user_id: input.userId,
      kind: input.kind,
      expires_at: input.expiresAt,
    })
    .execute()
}

// Redeems a token in ONE atomic statement: it deletes the row only if the hash
// matches, the kind matches, AND it has not expired, returning the user id it
// belonged to. Doing the check as part of the DELETE is what makes the token
// genuinely single-use even under a double-click or a replay — two concurrent
// redemptions cannot both delete the same row, so at most one sees the user id.
//
// A mismatched kind returns null rather than redeeming: a verification link must
// never double as a password-reset link, even though both live in one table.
// An expired-but-matching row is left in place for the cleanup sweep to drop.
export async function consumeAuthToken(
  tokenHash: string,
  kind: AuthTokenKind,
): Promise<string | null> {
  const row = await db
    .deleteFrom("auth_tokens")
    .where("id", "=", tokenHash)
    .where("kind", "=", kind)
    .where("expires_at", ">", new Date())
    .returning("user_id")
    .executeTakeFirst()
  return row?.user_id ?? null
}

// Invalidates every existing token of one kind for a user, so issuing a fresh
// link silently retires older ones — a user who requests two reset emails should
// find only the newer link works, and a completed reset should leave no live
// reset token behind.
export async function deleteAuthTokensForUserKind(
  userId: string,
  kind: AuthTokenKind,
): Promise<void> {
  await db
    .deleteFrom("auth_tokens")
    .where("user_id", "=", userId)
    .where("kind", "=", kind)
    .execute()
}

// When the most recent token of this kind for this user was issued, or null if
// there is none. Backs the anti-spam cooldown: the route refuses to send another
// email (and to mint another token) if the last one is younger than the cooldown
// window, which is what stops an attacker using the endpoint to flood a victim's
// inbox. Checked BEFORE deleteAuthTokensForUserKind so the age survives issuing.
export async function latestAuthTokenIssuedAt(
  userId: string,
  kind: AuthTokenKind,
): Promise<Date | null> {
  const row = await db
    .selectFrom("auth_tokens")
    .select("created_at")
    .where("user_id", "=", userId)
    .where("kind", "=", kind)
    .orderBy("created_at", "desc")
    .limit(1)
    .executeTakeFirst()
  return row?.created_at ?? null
}

// Housekeeping: drop tokens past their expiry. Expired tokens are already
// refused by consumeAuthToken, so this only stops the table growing — the same
// "bound every table" discipline as deleteExpiredSessions.
export async function deleteExpiredAuthTokens(): Promise<number> {
  const result = await db
    .deleteFrom("auth_tokens")
    .where("expires_at", "<=", new Date())
    .executeTakeFirst()
  return Number(result.numDeletedRows ?? 0n)
}
//#endregion
