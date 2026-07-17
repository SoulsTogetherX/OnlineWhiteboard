//#region What this migration does
// Splits the single `canvases` table into two: `rooms` (identity + metadata)
// and `canvas_snapshots` (the pixel checkpoint). It then MOVES the existing
// data across before dropping `canvases`, so a deployment that already has
// drawings loses nothing.
//
// This is the part people skip and regret: a migration that adds tables is
// easy; a migration that RESHAPES live data has to carry that data forward in
// the same step. The three INSERT ... SELECT statements below are the whole
// point — run against an existing database they preserve every canvas; run
// against a fresh one they select zero rows and do nothing.
//#endregion

//#region Imports
import { sql, type Kysely } from "kysely"
//#endregion

//#region Migration
export async function up(db: Kysely<unknown>): Promise<void> {
  // 1. Room identity + metadata.
  await sql`
    CREATE TABLE rooms (
      id         TEXT PRIMARY KEY,
      title      TEXT,
      width      INTEGER NOT NULL,
      height     INTEGER NOT NULL,
      revision   INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `.execute(db)

  // 2. Pixel checkpoints. ON DELETE CASCADE ties a snapshot's lifetime to its
  //    room — delete the room and its snapshot goes with it, integrity a
  //    single-table design can't express.
  await sql`
    CREATE TABLE canvas_snapshots (
      room_id    TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
      revision   INTEGER NOT NULL,
      width      INTEGER NOT NULL,
      height     INTEGER NOT NULL,
      rgba       BYTEA NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (room_id, revision)
    );
  `.execute(db)

  // 3. Carry existing data forward. Each old canvas row becomes one room and
  //    one snapshot at that room's revision. On a fresh database these select
  //    nothing. Uses the old row's updated_at as both timestamps so history
  //    isn't rewritten to "now".
  await sql`
    INSERT INTO rooms (id, width, height, revision, created_at, updated_at)
    SELECT room_id, width, height, revision, updated_at, updated_at
    FROM canvases;
  `.execute(db)

  await sql`
    INSERT INTO canvas_snapshots (room_id, revision, width, height, rgba, created_at)
    SELECT room_id, revision, width, height, rgba, updated_at
    FROM canvases;
  `.execute(db)

  // 4. The old table's data now lives in the new shape; drop it.
  await sql`DROP TABLE canvases;`.execute(db)
}

export async function down(db: Kysely<unknown>): Promise<void> {
  // Reverse the split: rebuild canvases from the latest snapshot per room, then
  // drop the new tables. DISTINCT ON (room_id) ... ORDER BY revision DESC picks
  // each room's highest-revision snapshot — Postgres's idiom for "latest per
  // group".
  await sql`
    CREATE TABLE canvases (
      room_id TEXT PRIMARY KEY,
      width INTEGER NOT NULL,
      height INTEGER NOT NULL,
      rgba BYTEA NOT NULL,
      revision INTEGER NOT NULL DEFAULT 0,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `.execute(db)

  await sql`
    INSERT INTO canvases (room_id, width, height, rgba, revision, updated_at)
    SELECT DISTINCT ON (s.room_id)
      s.room_id, s.width, s.height, s.rgba, s.revision, r.updated_at
    FROM canvas_snapshots s
    JOIN rooms r ON r.id = s.room_id
    ORDER BY s.room_id, s.revision DESC;
  `.execute(db)

  await sql`DROP TABLE canvas_snapshots;`.execute(db)
  await sql`DROP TABLE rooms;`.execute(db)
}
//#endregion
