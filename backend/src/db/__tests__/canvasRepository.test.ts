//#region Imports
import { randomUUID } from "node:crypto"

import { afterAll, beforeAll, describe, expect, it } from "vitest"

import pool, { db } from "../pool"
import { loadCanvas, saveCanvas } from "../canvasRepository"
import { runMigrations } from "../migrate"

import { CANVAS_BYTES, CANVAS_HEIGHT, CANVAS_WIDTH } from "@shared/constants/canvas"
//#endregion

//#region Gate
// These are INTEGRATION tests — they need a real Postgres. They run when the DB
// credentials are present (CI provides a postgres service; locally, point them
// at the dev stack: see backend/README or run with POSTGRES_* env set). With no
// database configured the whole suite is skipped so `npm test` stays green on a
// bare machine rather than failing on a connection error.
const DB_CONFIGURED = Boolean(process.env.POSTGRES_PASSWORD)
//#endregion

//#region Helpers
// A distinctive, non-blank pixel pattern so a round-trip failure is obvious and
// a blank-canvas fallback can never masquerade as success.
function patternedCanvas(): Uint8ClampedArray {
  const pixels = new Uint8ClampedArray(CANVAS_BYTES)
  for (let i = 0; i < pixels.length; i += 4) {
    pixels[i] = i % 256 // R varies
    pixels[i + 1] = 0
    pixels[i + 2] = 128
    pixels[i + 3] = 255 // opaque
  }
  return pixels
}
//#endregion

//#region Tests
describe.skipIf(!DB_CONFIGURED)("canvasRepository (integration)", () => {
  const createdRooms: string[] = []

  const freshRoomId = (): string => {
    const id = `it-${randomUUID()}`
    createdRooms.push(id)
    return id
  }

  beforeAll(async () => {
    // Idempotent — brings a fresh CI database up to the latest schema, and is a
    // no-op against an already-migrated dev database.
    await runMigrations()
  })

  afterAll(async () => {
    // Deleting the room cascades to its snapshots (ON DELETE CASCADE), so this
    // one delete cleans up everything the suite created.
    for (const id of createdRooms) {
      await db.deleteFrom("rooms").where("id", "=", id).execute()
    }
    // db.destroy() ends the underlying pg Pool (Kysely owns it via the dialect),
    // so calling pool.end() as well would double-close it. One is enough.
    await db.destroy()
  })

  it("returns a blank canvas at revision 0 for a room that has never been saved", async () => {
    const result = await loadCanvas(freshRoomId())

    expect(result.revision).toBe(0)
    expect(result.pixels).toHaveLength(CANVAS_BYTES)
    expect(result.pixels.every((byte) => byte === 0)).toBe(true)
  })

  it("round-trips a saved canvas byte-for-byte with its revision", async () => {
    const roomId = freshRoomId()
    const pixels = patternedCanvas()

    await saveCanvas(roomId, pixels, 7)
    const loaded = await loadCanvas(roomId)

    expect(loaded.revision).toBe(7)
    expect(Array.from(loaded.pixels)).toEqual(Array.from(pixels))
  })

  it("keeps only the latest snapshot when saved repeatedly", async () => {
    const roomId = freshRoomId()

    await saveCanvas(roomId, patternedCanvas(), 1)
    await saveCanvas(roomId, patternedCanvas(), 2)
    await saveCanvas(roomId, patternedCanvas(), 3)

    // loadCanvas reads the newest revision...
    const loaded = await loadCanvas(roomId)
    expect(loaded.revision).toBe(3)

    // ...and the superseded checkpoints were pruned, so exactly one row remains.
    const rows = await db
      .selectFrom("canvas_snapshots")
      .select("revision")
      .where("room_id", "=", roomId)
      .execute()
    expect(rows).toEqual([{ revision: 3 }])
  })

  it("creates and then advances the room's head revision on save", async () => {
    const roomId = freshRoomId()

    await saveCanvas(roomId, patternedCanvas(), 4)
    await saveCanvas(roomId, patternedCanvas(), 9)

    const room = await db
      .selectFrom("rooms")
      .select(["revision", "width", "height"])
      .where("id", "=", roomId)
      .executeTakeFirstOrThrow()

    expect(room.revision).toBe(9)
    expect(room.width).toBe(CANVAS_WIDTH)
    expect(room.height).toBe(CANVAS_HEIGHT)
  })

  it("falls back to blank when the stored snapshot's dimensions don't match", async () => {
    const roomId = freshRoomId()

    // Simulate a canvas saved under different dimensions (e.g. before
    // CANVAS_WIDTH changed) by writing the row directly.
    await db
      .insertInto("rooms")
      .values({
        id: roomId,
        width: CANVAS_WIDTH + 1,
        height: CANVAS_HEIGHT,
        revision: 5,
        updated_at: new Date(),
      })
      .execute()
    await db
      .insertInto("canvas_snapshots")
      .values({
        room_id: roomId,
        revision: 5,
        width: CANVAS_WIDTH + 1,
        height: CANVAS_HEIGHT,
        rgba: Buffer.alloc((CANVAS_WIDTH + 1) * CANVAS_HEIGHT * 4, 200),
      })
      .execute()

    const loaded = await loadCanvas(roomId)

    expect(loaded.revision).toBe(0)
    expect(loaded.pixels.every((byte) => byte === 0)).toBe(true)
  })

  it("cascades snapshot deletion when a room is deleted", async () => {
    const roomId = freshRoomId()
    await saveCanvas(roomId, patternedCanvas(), 1)

    await db.deleteFrom("rooms").where("id", "=", roomId).execute()

    const rows = await db
      .selectFrom("canvas_snapshots")
      .select("revision")
      .where("room_id", "=", roomId)
      .execute()
    expect(rows).toHaveLength(0)
  })
})
//#endregion
