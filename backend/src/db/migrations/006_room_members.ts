//#region What this migration does
// Adds room membership with roles — the many-to-many between users and rooms
// that turns "accounts exist" into "accounts mean something". A row says "user U
// has role R in room X".
//
// Roles:
//   owner  — created/claimed the room; can manage members' roles.
//   editor — can draw and (later) make/restore checkpoints.
//   viewer — read-only; can watch the canvas and presence but not draw.
//
// Two Postgres touches worth calling out:
//   - CHECK constraint pins role to the three valid values at the database
//     level, so a bug or a bad migration can't store "editorr".
//   - A PARTIAL UNIQUE INDEX enforces AT MOST ONE owner per room. This is what
//     makes "first registered user claims ownership" race-safe: two users
//     joining a brand-new room at the same moment can't both become owner —
//     the second's owner INSERT fails the unique index and falls back to editor.
//#endregion

//#region Imports
import { sql, type Kysely } from "kysely"
//#endregion

//#region Migration
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    CREATE TABLE room_members (
      room_id    TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
      user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      role       TEXT NOT NULL CHECK (role IN ('owner', 'editor', 'viewer')),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (room_id, user_id)
    );
  `.execute(db)

  // "My rooms" (the dashboard) queries by user_id; the primary key leads with
  // room_id, so this index serves the other direction.
  await sql`
    CREATE INDEX room_members_user_idx ON room_members (user_id);
  `.execute(db)

  // At most one owner per room. The WHERE clause makes it a partial index, so it
  // constrains only owner rows and lets any number of editors/viewers coexist.
  await sql`
    CREATE UNIQUE INDEX room_one_owner ON room_members (room_id)
    WHERE role = 'owner';
  `.execute(db)
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`DROP TABLE IF EXISTS room_members;`.execute(db)
}
//#endregion
