//#region What this migration does
// Adds accounts. `users` holds an identity (email, display name, a per-user
// presence colour) and a password hash — never the password itself. `sessions`
// is a server-side session store: one row per active login, referenced by an
// opaque cookie.
//
// Two security choices are baked into the schema:
//   - email is UNIQUE and stored lower-cased by the app, so "A@x.com" and
//     "a@x.com" can't become two accounts.
//   - sessions.id is the SHA-256 HASH of the cookie token, not the token
//     itself. The raw token lives only in the user's cookie; a leak of the
//     sessions table therefore hands an attacker hashes they can't use to
//     impersonate anyone. Same reasoning as never storing raw passwords.
//#endregion

//#region Imports
import { sql, type Kysely } from "kysely"
//#endregion

//#region Migration
export async function up(db: Kysely<unknown>): Promise<void> {
  // gen_random_uuid() is built into Postgres 13+ core, so no pgcrypto extension
  // is needed on Postgres 18.
  await sql`
    CREATE TABLE users (
      id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      email         TEXT NOT NULL UNIQUE,
      username      TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      color         TEXT NOT NULL,
      created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `.execute(db)

  await sql`
    CREATE TABLE sessions (
      id         TEXT PRIMARY KEY,
      user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      expires_at TIMESTAMPTZ NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `.execute(db)

  // Expired-session sweeps filter on expires_at; index it so that stays cheap.
  await sql`CREATE INDEX sessions_expires_at_idx ON sessions (expires_at);`.execute(db)
}

export async function down(db: Kysely<unknown>): Promise<void> {
  // sessions first — it FKs users.
  await sql`DROP TABLE IF EXISTS sessions;`.execute(db)
  await sql`DROP TABLE IF EXISTS users;`.execute(db)
}
//#endregion
