//#region Imports
import { db } from "./pool"

import { CANVAS_HEIGHT, CANVAS_WIDTH } from "@shared/constants/canvas"

import type { DrawInstruction } from "@shared/types/drawProtocol"
//#endregion

//#region Type Defs
// One entry in the append buffer: the instruction that was applied and the
// revision it produced. sessionId comes off the instruction itself
// (BaseInstruction.sessionId) so callers don't pass it separately.
export type DrawEvent = {
  revision: number
  instruction: DrawInstruction
}
//#endregion

//#region Room Existence
// draw_events.room_id and canvas_snapshots.room_id both FOREIGN KEY to rooms.id,
// so a room row has to exist before the first event or snapshot references it.
// Snapshots are only written every 15s, but events flush within a second of the
// first stroke — so without this, the very first flush of a brand-new room would
// fail the foreign key. Called once when a room is first loaded into memory.
//
// ON CONFLICT DO NOTHING: never downgrade an existing room's revision/metadata,
// just guarantee the row is there.
export async function ensureRoom(roomId: string): Promise<void> {
  await db
    .insertInto("rooms")
    .values({
      id: roomId,
      width: CANVAS_WIDTH,
      height: CANVAS_HEIGHT,
      updated_at: new Date(),
    })
    .onConflict((oc) => oc.column("id").doNothing())
    .execute()
}
//#endregion

//#region Event Log
// Appends a batch of events in one INSERT. Batching is the whole durability
// strategy: instead of a database round-trip per stroke segment (too slow at
// ~120 events/sec), the room manager buffers events and flushes them together a
// few times a second.
//
// ON CONFLICT (room_id, revision) DO NOTHING makes the whole thing idempotent —
// if a flush is retried after a partial failure, already-stored events are
// silently skipped instead of erroring on the primary key.
export async function appendDrawEvents(
  roomId: string,
  events: DrawEvent[],
): Promise<void> {
  if (events.length === 0) {
    return
  }

  await db
    .insertInto("draw_events")
    .values(
      events.map((event) => ({
        room_id: roomId,
        revision: event.revision,
        // node-postgres does not serialise objects for a JSONB column, so hand
        // it a string; it parses back to an object automatically on read.
        instruction: JSON.stringify(event.instruction),
        session_id: event.instruction.sessionId ?? null,
      })),
    )
    .onConflict((oc) => oc.columns(["room_id", "revision"]).doNothing())
    .execute()
}

// Loads every event newer than a snapshot's revision, in apply order. This is
// the replay half of recovery: the caller starts from the snapshot's pixels and
// applies these in sequence to reconstruct the exact pre-crash canvas. Ordering
// by revision is what makes replay deterministic — including for CAS patches,
// whose "from" colours only match when prior events are re-applied in the same
// order they originally were.
export async function loadEventsSince(
  roomId: string,
  sinceRevision: number,
): Promise<DrawEvent[]> {
  const rows = await db
    .selectFrom("draw_events")
    .select(["revision", "instruction"])
    .where("room_id", "=", roomId)
    .where("revision", ">", sinceRevision)
    .orderBy("revision", "asc")
    .execute()

  // instruction comes back already parsed (jsonb → JS object) and typed as
  // DrawInstruction by the schema's ColumnType.
  return rows.map((row) => ({
    revision: row.revision,
    instruction: row.instruction,
  }))
}
//#endregion
