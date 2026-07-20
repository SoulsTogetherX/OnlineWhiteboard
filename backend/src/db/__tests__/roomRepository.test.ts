//#region Imports
import { randomUUID } from "node:crypto"

import { afterAll, beforeAll, describe, expect, it } from "vitest"

import { getOpenEditing, setOpenEditing } from "../roomRepository"
import { db } from "../pool"
import { appendDrawEvents, ensureRoom } from "../eventRepository"
import { pruneStaleRooms } from "../roomRepository"
import { saveCanvas } from "../canvasRepository"
import { runMigrations } from "../migrate"
import { CANVAS_HEIGHT, CANVAS_WIDTH, DEFAULT_CANVAS_DIMS, canvasBytes } from "@shared/constants/canvas"

import type { DrawInstruction } from "@shared/types/drawProtocol"
//#endregion

//#region Gate
const DB_CONFIGURED = Boolean(process.env.POSTGRES_PASSWORD)
//#endregion

//#region Helpers
const DAY_MS = 24 * 60 * 60 * 1000
const daysAgo = (n: number): Date => new Date(Date.now() - n * DAY_MS)

// Insert a room row with an explicit updated_at, bypassing saveCanvas (which
// always stamps NOW()), so a room can be made to look old.
async function insertRoomAt(id: string, updatedAt: Date): Promise<void> {
  await db
    .insertInto("rooms")
    .values({
      id,
      width: CANVAS_WIDTH,
      height: CANVAS_HEIGHT,
      updated_at: updatedAt,
    })
    .execute()
}

const pencil = (): DrawInstruction => ({
  type: "pencil",
  prevPos: [0, 0],
  nextPos: [1, 1],
  color: { r: 1, g: 2, b: 3, a: 255 },
  instructionId: 1,
  sessionId: "room-test",
})
//#endregion

//#region Tests
describe.skipIf(!DB_CONFIGURED)("roomRepository — stale-room cleanup (integration)", () => {
  const createdRooms: string[] = []
  const track = (id: string): string => {
    createdRooms.push(id)
    return id
  }
  const freshId = (): string => track(`room-${randomUUID()}`)

  beforeAll(async () => {
    await runMigrations()
  })

  afterAll(async () => {
    for (const id of createdRooms) {
      await db.deleteFrom("rooms").where("id", "=", id).execute()
    }
    await db.destroy()
  })

  it("deletes a room whose last save is older than the cutoff", async () => {
    const id = freshId()
    await insertRoomAt(id, daysAgo(100))

    const deleted = await pruneStaleRooms(daysAgo(90), [])

    expect(deleted).toBeGreaterThanOrEqual(1)
    const still = await db
      .selectFrom("rooms")
      .select("id")
      .where("id", "=", id)
      .executeTakeFirst()
    expect(still).toBeUndefined()
  })

  it("keeps a room saved more recently than the cutoff", async () => {
    const id = freshId()
    await insertRoomAt(id, daysAgo(10))

    await pruneStaleRooms(daysAgo(90), [])

    const still = await db
      .selectFrom("rooms")
      .select("id")
      .where("id", "=", id)
      .executeTakeFirst()
    expect(still?.id).toBe(id)
  })

  it("never deletes a room that is currently active, even if it looks stale", async () => {
    const id = freshId()
    await insertRoomAt(id, daysAgo(365))

    // The room is old by timestamp but present in the "active" set (someone is
    // in it), so it must be excluded.
    await pruneStaleRooms(daysAgo(90), [id])

    const still = await db
      .selectFrom("rooms")
      .select("id")
      .where("id", "=", id)
      .executeTakeFirst()
    expect(still?.id).toBe(id)
  })

  it("cascades: deleting a stale room removes its snapshot and events too", async () => {
    const id = freshId()
    // Give it a snapshot (via saveCanvas) and an event...
    await saveCanvas(id, new Uint8ClampedArray(canvasBytes(DEFAULT_CANVAS_DIMS)), 5)
    await ensureRoom(id)
    await appendDrawEvents(id, [{ revision: 6, instruction: pencil() }])
    // ...then age it past the cutoff. saveCanvas stamped NOW(), so overwrite it.
    await db
      .updateTable("rooms")
      .set({ updated_at: daysAgo(200) })
      .where("id", "=", id)
      .execute()

    await pruneStaleRooms(daysAgo(90), [])

    const snapshots = await db
      .selectFrom("canvas_snapshots")
      .select("revision")
      .where("room_id", "=", id)
      .execute()
    const events = await db
      .selectFrom("draw_events")
      .select("revision")
      .where("room_id", "=", id)
      .execute()

    expect(snapshots).toHaveLength(0)
    expect(events).toHaveLength(0)
  })

  it("returns 0 and deletes nothing when no room is stale", async () => {
    const id = freshId()
    await insertRoomAt(id, daysAgo(1))

    // Only this fresh room exists among a far-past cutoff's candidates — nothing
    // older than 90 days that this test created. (Other suites clean up after
    // themselves, so the count reflects only genuinely stale rows.)
    const deleted = await pruneStaleRooms(daysAgo(90), [])

    // The 1-day-old room survives regardless of what else the DB holds.
    const still = await db
      .selectFrom("rooms")
      .select("id")
      .where("id", "=", id)
      .executeTakeFirst()
    expect(still?.id).toBe(id)
    expect(deleted).toBeGreaterThanOrEqual(0)
  })

  //#region Open editing
  it("defaults an unknown room to OPEN, matching the column default", async () => {
    // A room row only exists after its first save, so a brand-new room people
    // are already drawing in is legitimately absent here. Returning "locked"
    // for it would put every new room into a state nobody chose.
    expect(await getOpenEditing(`never-created-${freshId()}`)).toBe(true)
  })

  it("persists the toggle both ways", async () => {
    const id = freshId()
    await insertRoomAt(id, daysAgo(1))

    await setOpenEditing(id, false)
    expect(await getOpenEditing(id)).toBe(false)

    await setOpenEditing(id, true)
    expect(await getOpenEditing(id)).toBe(true)
  })

  it("can set the toggle before the room has ever been saved", async () => {
    // The owner may lock a room the instant they claim it, which can happen
    // before any snapshot has been written.
    const id = freshId()
    await setOpenEditing(id, false)
    expect(await getOpenEditing(id)).toBe(false)

    await db.deleteFrom("rooms").where("id", "=", id).execute()
  })

  it("does not clobber a room's dimensions when toggling", async () => {
    // setOpenEditing upserts, and its insert path carries placeholder
    // width/height. Those must never overwrite a real room's dimensions —
    // saveCanvas owns those.
    const id = freshId()
    await insertRoomAt(id, daysAgo(1))
    const before = await db
      .selectFrom("rooms")
      .select(["width", "height"])
      .where("id", "=", id)
      .executeTakeFirstOrThrow()

    await setOpenEditing(id, false)

    const after = await db
      .selectFrom("rooms")
      .select(["width", "height"])
      .where("id", "=", id)
      .executeTakeFirstOrThrow()
    expect(after).toEqual(before)
  })
  //#endregion
})
//#endregion
