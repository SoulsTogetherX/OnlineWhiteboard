//#region Imports
import { randomUUID } from "node:crypto"

import { afterAll, beforeAll, describe, expect, it } from "vitest"

import { db } from "../pool"
import { ensureRoom } from "../eventRepository"
import {
  countOwners,
  ensureMembership,
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

  it("makes the first user the owner and later users editors", async () => {
    const roomId = await makeRoom()
    const alice = await makeUser()
    const bob = await makeUser()

    expect(await ensureMembership(roomId, alice)).toBe("owner")
    expect(await ensureMembership(roomId, bob)).toBe("editor")
    expect(await countOwners(roomId)).toBe(1)
  })

  it("is idempotent — re-joining keeps the same role", async () => {
    const roomId = await makeRoom()
    const alice = await makeUser()

    await ensureMembership(roomId, alice)
    expect(await ensureMembership(roomId, alice)).toBe("owner")
    expect(await resolveRole(roomId, alice)).toBe("owner")
  })

  it("only ever allows one owner even under concurrent claims", async () => {
    const roomId = await makeRoom()
    const a = await makeUser()
    const b = await makeUser()
    const c = await makeUser()

    // Fire all three ownership claims at once — the partial unique index must
    // let exactly one win as owner; the rest fall back to editor.
    const roles = await Promise.all([
      ensureMembership(roomId, a),
      ensureMembership(roomId, b),
      ensureMembership(roomId, c),
    ])

    expect(roles.filter((r) => r === "owner")).toHaveLength(1)
    expect(roles.filter((r) => r === "editor")).toHaveLength(2)
    expect(await countOwners(roomId)).toBe(1)
  })

  it("lets the owner change an editor's role", async () => {
    const roomId = await makeRoom()
    const owner = await makeUser()
    const editor = await makeUser()
    await ensureMembership(roomId, owner)
    await ensureMembership(roomId, editor)

    expect(await setRole(roomId, editor, "viewer")).toBe(true)
    expect(await resolveRole(roomId, editor)).toBe("viewer")
  })

  it("refuses to demote the last owner", async () => {
    const roomId = await makeRoom()
    const owner = await makeUser()
    await ensureMembership(roomId, owner)

    expect(await setRole(roomId, owner, "editor")).toBe(false)
    expect(await resolveRole(roomId, owner)).toBe("owner") // unchanged
  })

  it("transfers ownership when a member is promoted to owner", async () => {
    const roomId = await makeRoom()
    const a = await makeUser()
    const b = await makeUser()
    await ensureMembership(roomId, a) // owner
    await ensureMembership(roomId, b) // editor

    // Promoting b to owner demotes a — a room keeps exactly one owner.
    expect(await setRole(roomId, b, "owner")).toBe(true)
    expect(await resolveRole(roomId, b)).toBe("owner")
    expect(await resolveRole(roomId, a)).toBe("editor")
    expect(await countOwners(roomId)).toBe(1)
  })

  it("refuses to remove the last owner but removes others", async () => {
    const roomId = await makeRoom()
    const owner = await makeUser()
    const editor = await makeUser()
    await ensureMembership(roomId, owner)
    await ensureMembership(roomId, editor)

    expect(await removeMember(roomId, owner)).toBe(false)
    expect(await removeMember(roomId, editor)).toBe(true)
    expect(await resolveRole(roomId, editor)).toBeNull()
  })

  it("lists members with their usernames, and rooms for a user", async () => {
    const roomId = await makeRoom()
    const owner = await makeUser()
    await ensureMembership(roomId, owner)

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
