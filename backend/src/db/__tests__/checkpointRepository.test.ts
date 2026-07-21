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

  it("retains every event after the genesis base", async () => {
    const roomId = await makeRoom()
    // Seed the genesis base snapshot at revision 0 (what loadRoom does for a new
    // room), then draw and roll a snapshot on top.
    await saveCanvas(roomId, patterned(0), 0, DEFAULT_CANVAS_DIMS)
    await appendDrawEvents(roomId, [1, 2, 3, 4, 5, 6, 7, 8].map(ev))

    // A rolling save keeps the base + head snapshots and prunes nothing above the
    // base, so the whole span survives for start-to-end replay.
    await saveCanvas(roomId, patterned(9), 8, DEFAULT_CANVAS_DIMS)

    const remaining = await loadEventsSince(roomId, 0)
    expect(remaining.map((e) => e.revision)).toEqual([1, 2, 3, 4, 5, 6, 7, 8])
  })

  it("a resetBase save (resize) drops all prior snapshots and events", async () => {
    const roomId = await makeRoom()
    await saveCanvas(roomId, patterned(0), 0, DEFAULT_CANVAS_DIMS)
    await appendDrawEvents(roomId, [1, 2, 3].map(ev))

    // resetBase makes this snapshot the sole base+head and prunes everything it
    // supersedes — the resize hard boundary.
    await saveCanvas(roomId, patterned(1), 4, DEFAULT_CANVAS_DIMS, true)

    expect(await loadEventsSince(roomId, 0)).toHaveLength(0)
  })
})
//#endregion
