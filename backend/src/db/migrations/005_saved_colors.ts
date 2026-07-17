//#region What this migration does
// A per-account saved colour palette. Each row is one saved swatch for one user,
// stored as a canonical "#rrggbbaa" string. PRIMARY KEY (user_id, color)
// deduplicates — saving the same colour twice is a no-op. ON DELETE CASCADE ties
// the palette to the account, so deleting a user removes their swatches.
//
// Guests keep their palette in the browser (localStorage) instead; this table is
// only for logged-in users, which is the whole point of an account here.
//#endregion

//#region Imports
import { sql, type Kysely } from "kysely"
//#endregion

//#region Migration
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    CREATE TABLE saved_colors (
      user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      color      TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (user_id, color)
    );
  `.execute(db)

  // The palette is always listed oldest-first for one user, so index that.
  await sql`
    CREATE INDEX saved_colors_user_created_idx
      ON saved_colors (user_id, created_at);
  `.execute(db)
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`DROP TABLE saved_colors;`.execute(db)
}
//#endregion
