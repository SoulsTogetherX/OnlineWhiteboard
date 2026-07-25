//#region Imports
import { db } from "./pool"

import type { User } from "./userRepository"
//#endregion

//#region Repository
// Stores the HASH of a session token as the primary key (see the sessions table
// in 001_initial_schema).
// The caller hashes the raw cookie token before calling in, so this layer never
// sees the token itself.
export async function createSession(input: {
  tokenHash: string
  userId: string
  expiresAt: Date
}): Promise<void> {
  await db
    .insertInto("sessions")
    .values({
      id: input.tokenHash,
      user_id: input.userId,
      expires_at: input.expiresAt,
    })
    .execute()
}

// Resolves a session hash to its user, but only if the session hasn't expired.
// One joined query so a valid cookie costs a single round-trip.
export async function findUserBySessionHash(
  tokenHash: string,
): Promise<User | null> {
  const row = await db
    .selectFrom("sessions")
    .innerJoin("users", "users.id", "sessions.user_id")
    .select([
      "users.id as id",
      "users.username as username",
      "users.color as color",
      "users.email_verified_at as email_verified_at",
    ])
    .where("sessions.id", "=", tokenHash)
    .where("sessions.expires_at", ">", new Date())
    .executeTakeFirst()
  if (!row) {
    return null
  }
  // Collapse the nullable timestamp to the boolean the User shape exposes — the
  // same projection userRepository.toUser does, kept in step by hand because the
  // join selects the column directly rather than going through that finder.
  const { email_verified_at, ...rest } = row
  return { ...rest, emailVerified: email_verified_at !== null }
}

// Deletes EVERY session for a user, returning how many were removed. The write
// behind a completed password reset: resetting a password must invalidate all
// existing logins (the whole point when the reason is a suspected compromise),
// not just the one that happened to make the request — which is why it takes a
// user id rather than a token hash, unlike the self-scoped destroySession.
export async function deleteAllSessionsForUser(userId: string): Promise<number> {
  const result = await db
    .deleteFrom("sessions")
    .where("user_id", "=", userId)
    .executeTakeFirst()
  return Number(result.numDeletedRows ?? 0n)
}

export async function deleteSession(tokenHash: string): Promise<void> {
  await db.deleteFrom("sessions").where("id", "=", tokenHash).execute()
}

// Housekeeping: drop sessions past their expiry. Expired sessions are already
// treated as invalid by findUserBySessionHash, so this is purely to stop the
// table growing — same "bound every table" discipline as the room retention job.
export async function deleteExpiredSessions(): Promise<number> {
  const result = await db
    .deleteFrom("sessions")
    .where("expires_at", "<=", new Date())
    .executeTakeFirst()
  return Number(result.numDeletedRows ?? 0n)
}
//#endregion
