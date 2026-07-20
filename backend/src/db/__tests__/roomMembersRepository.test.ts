//#region Imports
import { randomUUID } from "node:crypto"

import { afterAll, beforeAll, describe, expect, it } from "vitest"

import { db } from "../pool"
import { ensureRoom } from "../eventRepository"
import {
  claimOwnership,
  ensureMembership,
  roomHasOwner,
  listMembers,
  listRoomsForUser,
  removeMember,
  resolveRole,
  setRole,
} from "../roomMembersRepository"
import { runMigrations } from "../migrate"
//#endregion

//#region Gate
const DB_CONFIGURED = Boolean(process.env.POSTGRES_PASSWORD)
//#endregion

//#region Helpers
const createdUsers: string[] = []
const createdRooms: string[] = []

async function makeUser(): Promise<string> {
  // These tests only care about membership, not identity, so the email columns
  // get unique placeholder values rather than real crypto — the blind index is
  // exercised properly in auth.test.ts. `id` is supplied explicitly because the
  // column no longer has a database default (it is the AAD for the ciphertext).
  const id = randomUUID()
  const row = await db
    .insertInto("users")
    .values({
      id,
      email_index: `idx-${randomUUID()}`,
      email_ciphertext: `v1.placeholder.${randomUUID()}`,
      username: `u-${randomUUID().slice(0, 8)}`,
      password_hash: "scrypt$1$00$00",
      color: "#123456",
    })
    .returning("id")
    .executeTakeFirstOrThrow()
  createdUsers.push(row.id)
  return row.id
}

async function makeRoom(): Promise<string> {
  const id = `rm-${randomUUID()}`
  await ensureRoom(id)
  createdRooms.push(id)
  return id
}
//#endregion

//#region Tests
describe.skipIf(!DB_CONFIGURED)("roomMembersRepository (integration)", () => {
  beforeAll(async () => {
    await runMigrations()
  })

  afterAll(async () => {
    for (const id of createdRooms) {
      await db.deleteFrom("rooms").where("id", "=", id).execute()
    }
    for (const id of createdUsers) {
      await db.deleteFrom("users").where("id", "=", id).execute()
    }
    await db.destroy()
  })

  it("makes EVERY joiner a viewer — nobody becomes owner by arriving", async () => {
    // The old behaviour handed ownership to whoever opened the link first.
    // Opening a link must not silently grant powers you never asked for.
    const roomId = await makeRoom()
    const alice = await makeUser()
    const bob = await makeUser()

    expect(await ensureMembership(roomId, alice)).toBe("viewer")
    expect(await ensureMembership(roomId, bob)).toBe("viewer")
    expect(await roomHasOwner(roomId)).toBe(false)
  })

  it("is idempotent — re-joining keeps the same role", async () => {
    const roomId = await makeRoom()
    const alice = await makeUser()

    await ensureMembership(roomId, alice)
    await claimOwnership(roomId, alice)
    // Re-joining must not demote an owner back to viewer.
    expect(await ensureMembership(roomId, alice)).toBe("owner")
    expect(await resolveRole(roomId, alice)).toBe("owner")
  })

  it("lets exactly one person claim an unowned room", async () => {
    const roomId = await makeRoom()
    const alice = await makeUser()
    const bob = await makeUser()
    await ensureMembership(roomId, alice)
    await ensureMembership(roomId, bob)

    expect(await claimOwnership(roomId, alice)).toBe("owner")
    // Second claim must be refused, not silently transfer ownership.
    expect(await claimOwnership(roomId, bob)).toBeNull()
    expect(await resolveRole(roomId, bob)).toBe("viewer")
    expect(await roomHasOwner(roomId)).toBe(true)
  })

  it("survives concurrent ownership claims (index, not check-then-write)", async () => {
    const roomId = await makeRoom()
    const a = await makeUser()
    const b = await makeUser()
    const c = await makeUser()
    await Promise.all([
      ensureMembership(roomId, a),
      ensureMembership(roomId, b),
      ensureMembership(roomId, c),
    ])

    // All three claim at the same instant. A read-then-write would let more
    // than one through; the partial unique index cannot.
    const results = await Promise.all([
      claimOwnership(roomId, a),
      claimOwnership(roomId, b),
      claimOwnership(roomId, c),
    ])

    expect(results.filter((r) => r === "owner")).toHaveLength(1)
    expect(results.filter((r) => r === null)).toHaveLength(2)
    expect(await roomHasOwner(roomId)).toBe(true)
  })

  it("lets the owner change another member's role", async () => {
    const roomId = await makeRoom()
    const owner = await makeUser()
    const member = await makeUser()
    await ensureMembership(roomId, owner)
    await ensureMembership(roomId, member)
    await claimOwnership(roomId, owner)

    expect(await setRole(roomId, member, "editor")).toBe(true)
    expect(await resolveRole(roomId, member)).toBe("editor")
  })

  it("refuses to demote the last owner", async () => {
    const roomId = await makeRoom()
    const owner = await makeUser()
    await ensureMembership(roomId, owner)
    await claimOwnership(roomId, owner)

    expect(await setRole(roomId, owner, "editor")).toBe(false)
    expect(await resolveRole(roomId, owner)).toBe("owner") // unchanged
  })

  it("transfers ownership when a member is promoted to owner", async () => {
    const roomId = await makeRoom()
    const a = await makeUser()
    const b = await makeUser()
    await ensureMembership(roomId, a)
    await ensureMembership(roomId, b)
    await claimOwnership(roomId, a)

    // Promoting b demotes a in the same transaction — a room keeps exactly one
    // owner, and there is never an instant with zero or two.
    expect(await setRole(roomId, b, "owner")).toBe(true)
    expect(await resolveRole(roomId, b)).toBe("owner")
    expect(await resolveRole(roomId, a)).toBe("editor")
    expect(await roomHasOwner(roomId)).toBe(true)
  })

  it("refuses to remove the last owner but removes others", async () => {
    const roomId = await makeRoom()
    const owner = await makeUser()
    const editor = await makeUser()
    await ensureMembership(roomId, owner)
    await ensureMembership(roomId, editor)
    await claimOwnership(roomId, owner)

    expect(await removeMember(roomId, owner)).toBe(false)
    expect(await removeMember(roomId, editor)).toBe(true)
    expect(await resolveRole(roomId, editor)).toBeNull()
  })

  it("lists members with their usernames, and rooms for a user", async () => {
    const roomId = await makeRoom()
    const owner = await makeUser()
    await ensureMembership(roomId, owner)
    await claimOwnership(roomId, owner)

    const members = await listMembers(roomId)
    expect(members.some((m) => m.userId === owner && m.role === "owner")).toBe(true)
    expect(members[0].username).toBeTruthy()

    const rooms = await listRoomsForUser(owner)
    expect(rooms.some((r) => r.roomId === roomId && r.role === "owner")).toBe(true)
  })

  it("cascades membership deletion when the room is deleted", async () => {
    const roomId = `rm-${randomUUID()}`
    await ensureRoom(roomId)
    const user = await makeUser()
    await ensureMembership(roomId, user)

    await db.deleteFrom("rooms").where("id", "=", roomId).execute()

    expect(await resolveRole(roomId, user)).toBeNull()
  })
})
//#endregion
