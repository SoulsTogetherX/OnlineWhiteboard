//#region Imports
import { db } from "./pool"
import { selectDecimatedSurvivors } from "./historyDecimation"

import type { CanvasDims } from "@shared/constants/canvas"
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
export async function ensureRoom(
  roomId: string,
  dims: CanvasDims,
): Promise<void> {
  await db
    .insertInto("rooms")
    .values({
      id: roomId,
      width: dims.width,
      height: dims.height,
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

//#region Decimation support
// How many events are retained above a revision — the size of the timeline span,
// used to decide whether it has grown past the decimation cap.
export async function countEvents(
  roomId: string,
  sinceRevision: number,
): Promise<number> {
  const row = await db
    .selectFrom("draw_events")
    .select((eb) => eb.fn.countAll<string>().as("count"))
    .where("room_id", "=", roomId)
    .where("revision", ">", sinceRevision)
    .executeTakeFirst()
  return Number(row?.count ?? 0)
}

// The revisions of the retained span (baseRevision, upToRevision], ascending —
// just the revisions, not the (heavy) instruction payloads, since decimation
// only needs to choose which ones to keep. `upToRevision` is bounded to the head
// snapshot so decimation can never touch the recovery tail (events past it).
export async function loadEventRevisions(
  roomId: string,
  sinceRevision: number,
  upToRevision: number,
): Promise<number[]> {
  const rows = await db
    .selectFrom("draw_events")
    .select("revision")
    .where("room_id", "=", roomId)
    .where("revision", ">", sinceRevision)
    .where("revision", "<=", upToRevision)
    .orderBy("revision", "asc")
    .execute()
  return rows.map((row) => row.revision)
}

// Deletes the given revisions for a room — the non-survivors chosen by uniform
// decimation. A no-op for an empty list.
export async function deleteEvents(
  roomId: string,
  revisions: number[],
): Promise<void> {
  if (revisions.length === 0) {
    return
  }
  await db
    .deleteFrom("draw_events")
    .where("room_id", "=", roomId)
    .where("revision", "in", revisions)
    .execute()
}

// Thin the retained event log to `cap` entries once it has grown past it (§16
// uniform decimation). Operates STRICTLY within (0, headRevision]: since
// saveCanvas prunes everything at or below the base, that range IS the retained
// timeline, and every event in it is baked into the head snapshot — so this can
// never touch the recovery tail (events past head) and is decoupled from
// durability. The count gate keeps the common case (under cap) to a single cheap
// COUNT; only an over-cap room pays for the load + delete.
export async function decimateRoomHistory(
  roomId: string,
  headRevision: number,
  cap: number,
): Promise<void> {
  if ((await countEvents(roomId, 0)) <= cap) {
    return
  }
  const revisions = await loadEventRevisions(roomId, 0, headRevision)
  const survivors = new Set(selectDecimatedSurvivors(revisions, cap))
  await deleteEvents(
    roomId,
    revisions.filter((revision) => !survivors.has(revision)),
  )
}
//#endregion
