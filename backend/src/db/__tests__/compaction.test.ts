//#region Imports
import { randomUUID } from "node:crypto"

import { afterAll, beforeAll, describe, expect, it } from "vitest"

import { db } from "../pool"
import { loadBaseCanvas, loadCanvas, saveCanvas } from "../canvasRepository"
import {
  appendDrawEvents,
  ensureRoom,
  loadEventsSince,
  type DrawEvent,
} from "../eventRepository"
import { runMigrations } from "../migrate"
import { applyDrawInstructionToCanvas } from "@shared/utils/handleCanvasProtocol"
import { DEFAULT_CANVAS_DIMS, canvasBytes } from "@shared/constants/canvas"

import type { DrawInstruction } from "@shared/types/drawProtocol"
//#endregion

//#region Gate
const DB_CONFIGURED = Boolean(process.env.POSTGRES_PASSWORD)
//#endregion

//#region Helpers
let counter = 0
const pencil = (n: number): DrawInstruction => ({
  type: "pencil",
  prevPos: [n % 100, 0],
  nextPos: [(n % 100) + 5, 5],
  color: { r: 255, g: 0, b: 0, a: 255 },
  instructionId: counter++,
  sessionId: "compaction-test",
})
const event = (revision: number): DrawEvent => ({
  revision,
  instruction: pencil(revision),
})

// Count remaining events for a room — the thing compaction is supposed to bound.
async function eventCount(roomId: string): Promise<number> {
  const rows = await loadEventsSince(roomId, 0)
  return rows.length
}
//#endregion

//#region Tests
describe.skipIf(!DB_CONFIGURED)("event-log compaction (integration)", () => {
  const createdRooms: string[] = []
  const freshRoomId = (): string => {
    const id = `cmp-${randomUUID()}`
    createdRooms.push(id)
    return id
  }

  beforeAll(async () => {
    await runMigrations()
  })

  afterAll(async () => {
    for (const id of createdRooms) {
      await db.deleteFrom("rooms").where("id", "=", id).execute()
    }
    await db.destroy()
  })

  it("deletes events at or below the snapshot revision when a checkpoint is written", async () => {
    const roomId = freshRoomId()
    await ensureRoom(roomId, DEFAULT_CANVAS_DIMS)
    await appendDrawEvents(roomId, [event(1), event(2), event(3), event(4), event(5)])
    expect(await eventCount(roomId)).toBe(5)

    // Checkpoint at revision 3: events 1..3 are now baked into the snapshot.
    await saveCanvas(roomId, new Uint8ClampedArray(canvasBytes(DEFAULT_CANVAS_DIMS)), 3, DEFAULT_CANVAS_DIMS)

    // Only events strictly newer than the snapshot survive.
    const remaining = await loadEventsSince(roomId, 0)
    expect(remaining.map((e) => e.revision)).toEqual([4, 5])
  })

  it("retains the full event history above the base across many saves", async () => {
    const roomId = freshRoomId()
    await ensureRoom(roomId, DEFAULT_CANVAS_DIMS)
    // Seed the genesis base at revision 0 (as loadRoom does for a new room), so
    // the timeline replays from the start and nothing above it is pruned.
    await saveCanvas(roomId, new Uint8ClampedArray(canvasBytes(DEFAULT_CANVAS_DIMS)), 0, DEFAULT_CANVAS_DIMS)

    let revision = 0
    // Simulate 10 rounds of "draw 20 strokes, then roll a snapshot".
    for (let round = 0; round < 10; round += 1) {
      const batch: DrawEvent[] = []
      for (let i = 0; i < 20; i += 1) {
        revision += 1
        batch.push(event(revision))
      }
      await appendDrawEvents(roomId, batch)
      await saveCanvas(roomId, new Uint8ClampedArray(canvasBytes(DEFAULT_CANVAS_DIMS)), revision, DEFAULT_CANVAS_DIMS)
    }

    // All 200 strokes survive above the base — the log grows with total drawing
    // now (start-to-end scrub), bounded only by uniform decimation (Stage 3), not
    // by compaction.
    expect(await eventCount(roomId)).toBe(200)

    // Only two snapshots remain: the base (revision 0) and the head.
    const snaps = await db
      .selectFrom("canvas_snapshots")
      .select("revision")
      .where("room_id", "=", roomId)
      .orderBy("revision", "asc")
      .execute()
    expect(snaps).toEqual([{ revision: 0 }, { revision }])
  })

  it("keeps a genesis base to replay from AND a head to recover from", async () => {
    const roomId = freshRoomId()
    await ensureRoom(roomId, DEFAULT_CANVAS_DIMS)
    await saveCanvas(roomId, new Uint8ClampedArray(canvasBytes(DEFAULT_CANVAS_DIMS)), 0, DEFAULT_CANVAS_DIMS)
    await appendDrawEvents(roomId, [event(1), event(2), event(3)])
    await saveCanvas(roomId, new Uint8ClampedArray(canvasBytes(DEFAULT_CANVAS_DIMS)), 3, DEFAULT_CANVAS_DIMS)

    const base = await loadBaseCanvas(roomId)
    const head = await loadCanvas(roomId)
    expect(base?.revision).toBe(0) // start-to-end playback replays forward from here
    expect(head.revision).toBe(3) // recovery reads from here
    // The whole span stays available after the base for scrubbing.
    expect((await loadEventsSince(roomId, 0)).map((e) => e.revision)).toEqual([
      1, 2, 3,
    ])
  })

  it("still recovers the exact canvas after compaction (snapshot + surviving events)", async () => {
    const roomId = freshRoomId()
    await ensureRoom(roomId, DEFAULT_CANVAS_DIMS)

    // Build a canvas by applying 3 strokes, then checkpoint it at revision 3.
    const canvas = new Uint8ClampedArray(canvasBytes(DEFAULT_CANVAS_DIMS))
    for (let r = 1; r <= 3; r += 1) {
      applyDrawInstructionToCanvas(canvas, pencilAt(r), DEFAULT_CANVAS_DIMS)
    }
    await appendDrawEvents(roomId, [evAt(1), evAt(2), evAt(3)])
    await saveCanvas(roomId, canvas, 3, DEFAULT_CANVAS_DIMS) // compacts events 1..3 away

    // Two more strokes drawn AFTER the checkpoint — these live only in the log.
    applyDrawInstructionToCanvas(canvas, pencilAt(4), DEFAULT_CANVAS_DIMS)
    applyDrawInstructionToCanvas(canvas, pencilAt(5), DEFAULT_CANVAS_DIMS)
    await appendDrawEvents(roomId, [evAt(4), evAt(5)])

    // Recover exactly as the room manager does: snapshot + events after it.
    const stored = await loadCanvas(roomId)
    const recovered = new Uint8ClampedArray(stored.pixels)
    const survivors = await loadEventsSince(roomId, stored.revision)
    for (const e of survivors) {
      applyDrawInstructionToCanvas(recovered, e.instruction, DEFAULT_CANVAS_DIMS)
    }

    expect(stored.revision).toBe(3) // recovered from the compacted snapshot
    expect(survivors.map((e) => e.revision)).toEqual([4, 5])
    expect(Array.from(recovered)).toEqual(Array.from(canvas))
  })
})

// Deterministic stroke keyed by revision, so the "expected" and "recovered"
// canvases apply identical instructions.
function pencilAt(r: number): DrawInstruction {
  return {
    type: "pencil",
    prevPos: [r, r],
    nextPos: [r + 8, r + 3],
    color: { r: 10 * r, g: 0, b: 0, a: 255 },
    instructionId: r,
    sessionId: "cmp",
  }
}
function evAt(r: number): DrawEvent {
  return { revision: r, instruction: pencilAt(r) }
}
//#endregion
