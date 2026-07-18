//#region What this migration does
// Adds named, DURABLE checkpoints — the "versions" of a canvas. Unlike the
// rolling canvas_snapshots table (which keeps only the latest, purely as a
// recovery shortcut), a checkpoint is a full-canvas snapshot that an editor
// deliberately saved with a name and that survives until someone deletes it.
//
// Checkpoints do double duty:
//   1. Restore points — jump the live canvas back to a saved version.
//   2. Keyframes for playback — because compaction is taught to keep the
//      draw_events newer than the OLDEST checkpoint (see canvasRepository), the
//      events between checkpoints survive, so history can be replayed forward
//      from any checkpoint. That's the reconciliation between "bounded storage"
//      and "watch the drawing get built".
//
// created_by is ON DELETE SET NULL, not CASCADE: deleting a user must not delete
// the checkpoints they made for a shared room — the version history belongs to
// the room, not the person.
//#endregion

//#region Imports
import { sql, type Kysely } from "kysely"
//#endregion

//#region Migration
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    CREATE TABLE checkpoints (
      id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      room_id    TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
      name       TEXT NOT NULL,
      revision   INTEGER NOT NULL,
      width      INTEGER NOT NULL,
      height     INTEGER NOT NULL,
      rgba       BYTEA NOT NULL,
      created_by UUID REFERENCES users(id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `.execute(db)

  // Listing a room's checkpoints newest-first, and finding the oldest one (for
  // the compaction floor), both key off (room_id, created_at).
  await sql`
    CREATE INDEX checkpoints_room_idx ON checkpoints (room_id, created_at);
  `.execute(db)
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`DROP TABLE IF EXISTS checkpoints;`.execute(db)
}
//#endregion
