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
import {
  createCheckpoint,
  deleteCheckpoint,
  listCheckpoints,
  loadCheckpoint,
  oldestCheckpointRevision,
} from "../checkpointRepository"
import { runMigrations } from "../migrate"
import { DEFAULT_CANVAS_DIMS, canvasBytes } from "@shared/constants/canvas"

import type { DrawInstruction } from "@shared/types/drawProtocol"
//#endregion

//#region Gate + helpers
const DB_CONFIGURED = Boolean(process.env.POSTGRES_PASSWORD)
const createdRooms: string[] = []

async function makeRoom(): Promise<string> {
  const id = `cp-${randomUUID()}`
  await ensureRoom(id, DEFAULT_CANVAS_DIMS)
  createdRooms.push(id)
  return id
}

function patterned(seed: number): Uint8ClampedArray {
  const px = new Uint8ClampedArray(canvasBytes(DEFAULT_CANVAS_DIMS))
  for (let i = 0; i < px.length; i += 4) {
    px[i] = (i + seed) % 256
    px[i + 3] = 255
  }
  return px
}

let counter = 0
const ev = (revision: number): DrawEvent => ({
  revision,
  instruction: {
    type: "pencil",
    prevPos: [revision % 100, 0],
    nextPos: [(revision % 100) + 3, 3],
    color: { r: 255, g: 0, b: 0, a: 255 },
    instructionId: counter++,
    sessionId: "cp",
  } as DrawInstruction,
})
//#endregion

//#region Tests
describe.skipIf(!DB_CONFIGURED)("checkpointRepository (integration)", () => {
  beforeAll(async () => {
    await runMigrations()
  })
  afterAll(async () => {
    for (const id of createdRooms) {
      await db.deleteFrom("rooms").where("id", "=", id).execute()
    }
    await db.destroy()
  })

  it("creates, lists (newest first), loads, and deletes a checkpoint", async () => {
    const roomId = await makeRoom()
    const a = await createCheckpoint({
      roomId,
      name: "first",
      revision: 3,
      pixels: patterned(1),
      dims: DEFAULT_CANVAS_DIMS,
      createdBy: null,
    })
    const b = await createCheckpoint({
      roomId,
      name: "second",
      revision: 7,
      pixels: patterned(2),
      dims: DEFAULT_CANVAS_DIMS,
      createdBy: null,
    })

    const list = await listCheckpoints(roomId)
    expect(list.map((c) => c.name)).toEqual(["second", "first"]) // desc by created_at
    expect(list[0].id).toBe(b.id)

    const loaded = await loadCheckpoint(roomId, a.id)
    expect(loaded?.revision).toBe(3)
    expect(Array.from(loaded!.pixels)).toEqual(Array.from(patterned(1)))

    expect(await deleteCheckpoint(roomId, a.id)).toBe(true)
    expect(await loadCheckpoint(roomId, a.id)).toBeNull()
  })

  it("reports the oldest checkpoint revision (the compaction floor)", async () => {
    const roomId = await makeRoom()
    expect(await oldestCheckpointRevision(roomId)).toBeNull()

    await createCheckpoint({ roomId, name: "x", revision: 9, pixels: patterned(1), dims: DEFAULT_CANVAS_DIMS, createdBy: null })
    await createCheckpoint({ roomId, name: "y", revision: 4, pixels: patterned(2), dims: DEFAULT_CANVAS_DIMS, createdBy: null })

    expect(await oldestCheckpointRevision(roomId)).toBe(4)
  })

  it("won't load a checkpoint from a different room", async () => {
    const roomA = await makeRoom()
    const roomB = await makeRoom()
    const cp = await createCheckpoint({ roomId: roomA, name: "a", revision: 1, pixels: patterned(1), dims: DEFAULT_CANVAS_DIMS, createdBy: null })

    expect(await loadCheckpoint(roomB, cp.id)).toBeNull()
  })

  it("cascades checkpoint deletion when the room is deleted", async () => {
    const roomId = `cp-${randomUUID()}`
    await ensureRoom(roomId, DEFAULT_CANVAS_DIMS)
    const cp = await createCheckpoint({ roomId, name: "a", revision: 1, pixels: patterned(1), dims: DEFAULT_CANVAS_DIMS, createdBy: null })

    await db.deleteFrom("rooms").where("id", "=", roomId).execute()
    expect(await loadCheckpoint(roomId, cp.id)).toBeNull()
  })

  it("COMPACTION retains events newer than the retain floor", async () => {
    const roomId = await makeRoom()
    await appendDrawEvents(
      roomId,
      [1, 2, 3, 4, 5, 6, 7, 8].map(ev),
    )

    // Snapshot at revision 8, but retain events after revision 5 (as if the
    // oldest checkpoint were at 5). Events 1..5 pruned; 6..8 kept for playback.
    await saveCanvas(roomId, patterned(9), 8, DEFAULT_CANVAS_DIMS, 5)

    const remaining = await loadEventsSince(roomId, 0)
    expect(remaining.map((e) => e.revision)).toEqual([6, 7, 8])
  })

  it("COMPACTION with no retain floor prunes everything the snapshot covers", async () => {
    const roomId = await makeRoom()
    await appendDrawEvents(roomId, [1, 2, 3].map(ev))

    await saveCanvas(roomId, patterned(1), 3, DEFAULT_CANVAS_DIMS, null)

    expect(await loadEventsSince(roomId, 0)).toHaveLength(0)
  })
})
//#endregion
