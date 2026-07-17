//#region What this migration does
// Adds the append-only event log — the durability backbone. Every applied draw
// instruction becomes one row here, keyed by (room_id, revision). Recovery
// after a crash is "load the latest snapshot, then replay every event with a
// higher revision", so the amount of work lost on a hard crash shrinks from the
// 15s snapshot interval to a sub-second flush window.
//
// Design notes:
//   - instruction is JSONB, not pixels. A bucket fill that paints thousands of
//     pixels is still ONE small row (the instruction, not its result), so the
//     log stays compact even as the canvas fills.
//   - PRIMARY KEY (room_id, revision): revision is already monotonic per room in
//     memory, so it doubles as the log's ordering key AND makes re-appending an
//     event idempotent (ON CONFLICT DO NOTHING) — safe to retry a failed flush.
//   - ON DELETE CASCADE ties events to their room, same as canvas_snapshots.
//#endregion

//#region Imports
import { sql, type Kysely } from "kysely"
//#endregion

//#region Migration
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    CREATE TABLE draw_events (
      room_id     TEXT    NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
      revision    INTEGER NOT NULL,
      instruction JSONB   NOT NULL,
      session_id  TEXT,
      created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (room_id, revision)
    );
  `.execute(db)

  // The recovery query is "events for this room with revision > N, in order".
  // The primary-key index on (room_id, revision) already serves that range scan,
  // so no extra index is needed — noting it here so a future reader doesn't add
  // a redundant one.
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`DROP TABLE draw_events;`.execute(db)
}
//#endregion
