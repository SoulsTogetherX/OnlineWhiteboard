//#region Imports
import { randomUUID } from "node:crypto"

import { afterAll, beforeAll, describe, expect, it } from "vitest"

import pool, { db } from "../pool"
import { loadCanvas, saveCanvas } from "../canvasRepository"
import { runMigrations } from "../migrate"

import { DEFAULT_CANVAS_DIMS, canvasBytes } from "@shared/constants/canvas"

import { packPixels } from "../pixelStorage"
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
function patternedCanvas(
  dims = DEFAULT_CANVAS_DIMS,
): Uint8ClampedArray {
  const pixels = new Uint8ClampedArray(canvasBytes(dims))
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
    expect(result.pixels).toHaveLength(canvasBytes(DEFAULT_CANVAS_DIMS))
    expect(result.pixels.every((byte) => byte === 0)).toBe(true)
  })

  it("round-trips a saved canvas byte-for-byte with its revision", async () => {
    const roomId = freshRoomId()
    const pixels = patternedCanvas()

    await saveCanvas(roomId, pixels, 7, DEFAULT_CANVAS_DIMS)
    const loaded = await loadCanvas(roomId)

    expect(loaded.revision).toBe(7)
    expect(Array.from(loaded.pixels)).toEqual(Array.from(pixels))
  })

  it("stores the canvas GZIPPED, not as raw bytes", async () => {
    // The round-trip test above passes whether or not compression happens — it
    // only proves pack and unpack agree with each other. This is what proves the
    // bytes in the column are actually compressed, and it is the assertion that
    // fails if someone "simplifies" packPixels back to Buffer.from().
    const roomId = freshRoomId()
    await saveCanvas(roomId, patternedCanvas(), 1, DEFAULT_CANVAS_DIMS)

    const row = await db
      .selectFrom("canvas_snapshots")
      .select("rgba")
      .where("room_id", "=", roomId)
      .executeTakeFirstOrThrow()

    expect(row.rgba.length).toBeLessThan(canvasBytes(DEFAULT_CANVAS_DIMS))
    // gzip magic number — 0x1f 0x8b.
    expect([row.rgba[0], row.rgba[1]]).toEqual([0x1f, 0x8b])
  })

  it("keeps the base and head snapshots, pruning intermediate ones", async () => {
    const roomId = freshRoomId()

    // The first save establishes the base (revision 1 here); later saves advance
    // the head and prune the snapshots strictly between base and head.
    await saveCanvas(roomId, patternedCanvas(), 1, DEFAULT_CANVAS_DIMS)
    await saveCanvas(roomId, patternedCanvas(), 2, DEFAULT_CANVAS_DIMS)
    await saveCanvas(roomId, patternedCanvas(), 3, DEFAULT_CANVAS_DIMS)

    // loadCanvas reads the newest revision (the head)...
    const loaded = await loadCanvas(roomId)
    expect(loaded.revision).toBe(3)

    // ...and exactly two snapshots survive: the base (1) and the head (3), with
    // the intermediate rolling snapshot (2) pruned. The base is what start-to-end
    // playback replays forward from.
    const rows = await db
      .selectFrom("canvas_snapshots")
      .select("revision")
      .where("room_id", "=", roomId)
      .orderBy("revision", "asc")
      .execute()
    expect(rows).toEqual([{ revision: 1 }, { revision: 3 }])
  })

  it("creates and then advances the room's head revision on save", async () => {
    const roomId = freshRoomId()

    await saveCanvas(roomId, patternedCanvas(), 4, DEFAULT_CANVAS_DIMS)
    await saveCanvas(roomId, patternedCanvas(), 9, DEFAULT_CANVAS_DIMS)

    const room = await db
      .selectFrom("rooms")
      .select(["revision", "width", "height"])
      .where("id", "=", roomId)
      .executeTakeFirstOrThrow()

    expect(room.revision).toBe(9)
    expect(room.width).toBe(DEFAULT_CANVAS_DIMS.width)
    expect(room.height).toBe(DEFAULT_CANVAS_DIMS.height)
  })

  it("loads a room at its OWN stored dimensions, not the default", async () => {
    // The per-room behaviour: a canvas saved at a non-default size loads back at
    // that size. This is what the old "reset on dimension mismatch" test became —
    // the snapshot's dimensions are now the room's, not something to reject.
    const roomId = freshRoomId()
    const dims = { width: 128, height: 192 }
    const pixels = patternedCanvas(dims)

    await saveCanvas(roomId, pixels, 3, dims)
    const loaded = await loadCanvas(roomId)

    expect(loaded.width).toBe(128)
    expect(loaded.height).toBe(192)
    expect(loaded.pixels).toHaveLength(canvasBytes(dims))
    expect(Array.from(loaded.pixels)).toEqual(Array.from(pixels))
  })

  it("falls back to blank when the stored pixels don't fit their dimensions", async () => {
    // A corrupt row: the stored (gzipped) bytes decompress to the wrong length
    // for the width/height recorded alongside them. loadCanvas must degrade to a
    // blank canvas rather than hand back a wrong-length buffer that every index
    // calculation downstream would trust.
    const roomId = freshRoomId()

    // Gzip a buffer that is one pixel too short for 120x120, then store it under
    // 120x120 dims — a genuine pixels/dimension disagreement.
    const shortPixels = new Uint8ClampedArray(120 * 120 * 4 - 4)
    await db
      .insertInto("rooms")
      .values({ id: roomId, width: 120, height: 120, revision: 5, updated_at: new Date() })
      .execute()
    await db
      .insertInto("canvas_snapshots")
      .values({
        room_id: roomId,
        revision: 5,
        width: 120,
        height: 120,
        rgba: packPixels(shortPixels),
      })
      .execute()

    const loaded = await loadCanvas(roomId)

    expect(loaded.revision).toBe(0)
    expect(loaded.pixels.every((byte) => byte === 0)).toBe(true)
  })

  it("cascades snapshot deletion when a room is deleted", async () => {
    const roomId = freshRoomId()
    await saveCanvas(roomId, patternedCanvas(), 1, DEFAULT_CANVAS_DIMS)

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
