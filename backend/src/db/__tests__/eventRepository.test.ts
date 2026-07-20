//#region Imports
import { randomUUID } from "node:crypto"

import { afterAll, beforeAll, describe, expect, it } from "vitest"

import { db } from "../pool"
import { saveCanvas } from "../canvasRepository"
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
const pencil = (
  prevPos: [number, number],
  nextPos: [number, number],
): DrawInstruction => ({
  type: "pencil",
  prevPos,
  nextPos,
  color: { r: 255, g: 0, b: 0, a: 255 },
  instructionId: counter++,
  sessionId: "evt-test",
})

const event = (revision: number, inst: DrawInstruction): DrawEvent => ({
  revision,
  instruction: inst,
})
//#endregion

//#region Tests
describe.skipIf(!DB_CONFIGURED)("eventRepository (integration)", () => {
  const createdRooms: string[] = []
  const freshRoomId = (): string => {
    const id = `evt-${randomUUID()}`
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

  it("appends events and loads them back in revision order", async () => {
    const roomId = freshRoomId()
    await ensureRoom(roomId)

    // Insert deliberately out of order to prove the query sorts, not the input.
    await appendDrawEvents(roomId, [
      event(2, pencil([2, 2], [3, 3])),
      event(1, pencil([0, 0], [1, 1])),
      event(3, pencil([4, 4], [5, 5])),
    ])

    const loaded = await loadEventsSince(roomId, 0)

    expect(loaded.map((e) => e.revision)).toEqual([1, 2, 3])
    expect(loaded[0].instruction.type).toBe("pencil")
  })

  it("loads only events strictly newer than a given revision", async () => {
    const roomId = freshRoomId()
    await ensureRoom(roomId)
    await appendDrawEvents(roomId, [
      event(1, pencil([0, 0], [1, 1])),
      event(2, pencil([2, 2], [3, 3])),
      event(3, pencil([4, 4], [5, 5])),
    ])

    const loaded = await loadEventsSince(roomId, 1)

    expect(loaded.map((e) => e.revision)).toEqual([2, 3])
  })

  it("is idempotent — re-appending the same revision does not duplicate or error", async () => {
    const roomId = freshRoomId()
    await ensureRoom(roomId)

    await appendDrawEvents(roomId, [event(1, pencil([0, 0], [1, 1]))])
    // Simulates a flush that partially succeeded and gets retried.
    await appendDrawEvents(roomId, [
      event(1, pencil([0, 0], [1, 1])),
      event(2, pencil([2, 2], [3, 3])),
    ])

    const loaded = await loadEventsSince(roomId, 0)
    expect(loaded.map((e) => e.revision)).toEqual([1, 2])
  })

  it("round-trips a JSONB instruction structurally intact", async () => {
    const roomId = freshRoomId()
    await ensureRoom(roomId)
    const original = pencil([7, 8], [9, 10])

    await appendDrawEvents(roomId, [event(1, original)])
    const [loaded] = await loadEventsSince(roomId, 0)

    expect(loaded.instruction).toEqual(original)
  })

  it("reconstructs a canvas from snapshot + replayed events (recovery path)", async () => {
    const roomId = freshRoomId()

    // Snapshot at revision 5 (blank), then two events drawn "after the
    // checkpoint" — the exact shape recovery faces after a crash.
    const snapshotPixels = new Uint8ClampedArray(canvasBytes(DEFAULT_CANVAS_DIMS))
    await saveCanvas(roomId, snapshotPixels, 5)
    await appendDrawEvents(roomId, [
      event(6, pencil([0, 0], [3, 0])),
      event(7, pencil([0, 1], [3, 1])),
    ])

    // Replay exactly as getOrCreateRoom does: start from the snapshot, apply
    // events with revision > snapshot revision through the shared function.
    const recovered = new Uint8ClampedArray(snapshotPixels)
    const events = await loadEventsSince(roomId, 5)
    for (const e of events) {
      applyDrawInstructionToCanvas(recovered, e.instruction, DEFAULT_CANVAS_DIMS)
    }

    // Build the expected canvas independently by applying the same strokes.
    const expected = new Uint8ClampedArray(canvasBytes(DEFAULT_CANVAS_DIMS))
    applyDrawInstructionToCanvas(expected, pencil([0, 0], [3, 0]), DEFAULT_CANVAS_DIMS)
    applyDrawInstructionToCanvas(expected, pencil([0, 1], [3, 1]), DEFAULT_CANVAS_DIMS)

    expect(events.map((e) => e.revision)).toEqual([6, 7])
    expect(Array.from(recovered)).toEqual(Array.from(expected))
  })

  it("cascades event deletion when the room is deleted", async () => {
    const roomId = freshRoomId()
    await ensureRoom(roomId)
    await appendDrawEvents(roomId, [event(1, pencil([0, 0], [1, 1]))])

    await db.deleteFrom("rooms").where("id", "=", roomId).execute()

    const rows = await loadEventsSince(roomId, 0)
    expect(rows).toHaveLength(0)
  })
})
//#endregion
