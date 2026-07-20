//#region What this migration does
// Replaces the plaintext `users.email` column with two derived columns:
//
//   email_index      — a slow-KDF blind index, UNIQUE, used for login lookup
//   email_ciphertext — AES-256-GCM, bound to the row via AAD = user id
//
// After this runs, a read-only dump of the database contains no readable email
// addresses. Recovering one requires a secret that is deliberately not stored in
// the database at all (see auth/emailCrypto.ts for the full reasoning).
//
// EXISTING ROWS ARE MIGRATED, not discarded: each address is read once, indexed
// and encrypted, then the plaintext column is dropped. On a fresh database the
// backfill selects nothing and this is pure DDL.
//
// A NOTE ON THE COUPLING: this migration imports application crypto, which is
// normally something to avoid — a migration should ideally be frozen in time,
// and importing live code means changing that code retroactively changes what
// this migration would do. It is done deliberately here because the alternative
// is reimplementing the KDF and AEAD inline, where it could drift from the real
// one and produce indexes that never match at login. If the crypto format ever
// changes, write a NEW migration; do not edit this one.
//#endregion

//#region Imports
import { sql, type Kysely } from "kysely"

import { decryptEmail, emailBlindIndex, encryptEmail } from "@/auth/emailCrypto"
//#endregion

//#region Migration
export async function up(db: Kysely<unknown>): Promise<void> {
  // Added nullable so existing rows survive until the backfill fills them.
  await sql`ALTER TABLE users ADD COLUMN email_index TEXT`.execute(db)
  await sql`ALTER TABLE users ADD COLUMN email_ciphertext TEXT`.execute(db)

  const existing = await sql<{ id: string; email: string }>`
    SELECT id, email FROM users
  `.execute(db)

  for (const row of existing.rows) {
    const index = await emailBlindIndex(row.email)
    const ciphertext = encryptEmail(row.email, row.id)
    await sql`
      UPDATE users
      SET email_index = ${index}, email_ciphertext = ${ciphertext}
      WHERE id = ${row.id}
    `.execute(db)
  }

  if (existing.rows.length > 0) {
    console.log(`migrated ${existing.rows.length} email address(es) to rest encryption`)
  }

  // Only now can these be mandatory.
  await sql`ALTER TABLE users ALTER COLUMN email_index SET NOT NULL`.execute(db)
  await sql`ALTER TABLE users ALTER COLUMN email_ciphertext SET NOT NULL`.execute(db)

  // Carries the uniqueness the plaintext column used to enforce. Because the
  // index is deterministic, "same address" still means "same row" — the
  // constraint survives the encryption.
  await sql`
    CREATE UNIQUE INDEX users_email_index_key ON users (email_index)
  `.execute(db)

  await sql`ALTER TABLE users DROP COLUMN email`.execute(db)
}

// Reversible only because the ciphertext is recoverable — which is precisely the
// property the blind-index-plus-encryption design was chosen to keep. A
// hash-only design would have made this irreversible.
export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`ALTER TABLE users ADD COLUMN email TEXT`.execute(db)

  const rows = await sql<{ id: string; email_ciphertext: string }>`
    SELECT id, email_ciphertext FROM users
  `.execute(db)

  for (const row of rows.rows) {
    const email = decryptEmail(row.email_ciphertext, row.id)
    await sql`UPDATE users SET email = ${email} WHERE id = ${row.id}`.execute(db)
  }

  await sql`ALTER TABLE users ALTER COLUMN email SET NOT NULL`.execute(db)
  await sql`ALTER TABLE users ADD CONSTRAINT users_email_key UNIQUE (email)`.execute(db)
  await sql`DROP INDEX IF EXISTS users_email_index_key`.execute(db)
  await sql`ALTER TABLE users DROP COLUMN email_index`.execute(db)
  await sql`ALTER TABLE users DROP COLUMN email_ciphertext`.execute(db)
}
//#endregion
