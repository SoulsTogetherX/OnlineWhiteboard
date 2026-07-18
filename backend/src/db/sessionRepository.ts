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
      "users.email as email",
      "users.username as username",
      "users.color as color",
    ])
    .where("sessions.id", "=", tokenHash)
    .where("sessions.expires_at", ">", new Date())
    .executeTakeFirst()
  return row ?? null
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
