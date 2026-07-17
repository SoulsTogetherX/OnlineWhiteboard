//#region Why this migration looks like the table already exists
// This is the BASELINE. It creates `canvases` exactly as the app has always
// had it — same columns, same types. Its job is not to change anything; it is
// to bring the pre-existing schema UNDER the migration system's management so
// that from here on, every schema change is an ordered, tracked migration
// instead of an init script that only runs on an empty volume plus an
// idempotent CREATE-IF-NOT-EXISTS on every save.
//
// `CREATE TABLE IF NOT EXISTS` (not a bare CREATE) is deliberate: an existing
// deployment already has this table from the old database/notes_table.sql init
// script. On those databases this migration is a no-op that simply records
// "001 has run"; on a fresh database it actually creates the table. Either way
// the end state is identical, which is what makes adopting an existing schema
// safe.
//#endregion

//#region Imports
import { sql, type Kysely } from "kysely"
//#endregion

//#region Migration
// Migrations are typed against `any`: they run across the schema's whole
// history, so pinning them to today's Database interface would break the moment
// that interface moves on. Raw SQL via the `sql` tag keeps the DDL explicit and
// reviewable — the query builder is for application queries, not schema.
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    CREATE TABLE IF NOT EXISTS canvases (
      room_id TEXT PRIMARY KEY,
      width INTEGER NOT NULL,
      height INTEGER NOT NULL,
      rgba BYTEA NOT NULL,
      revision INTEGER NOT NULL DEFAULT 0,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `.execute(db)
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`DROP TABLE IF EXISTS canvases;`.execute(db)
}
//#endregion
