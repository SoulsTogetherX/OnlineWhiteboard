//#region Imports
import { db } from "./pool"

import type { RoomRole } from "@shared/types/identity"
//#endregion

//#region Type Defs
export type RoomMember = {
  userId: string
  username: string
  color: string
  role: RoomRole
}

// A room as it appears on a user's "My Rooms" dashboard.
export type UserRoom = {
  roomId: string
  title: string | null
  role: RoomRole
  updatedAt: Date
}
//#endregion

//#region Membership
// Resolves a user's role in a room, or null if they aren't a member.
export async function resolveRole(
  roomId: string,
  userId: string,
): Promise<RoomRole | null> {
  const row = await db
    .selectFrom("room_members")
    .select("role")
    .where("room_id", "=", roomId)
    .where("user_id", "=", userId)
    .executeTakeFirst()
  return (row?.role as RoomRole | undefined) ?? null
}

// Ensures the user has a membership in the room, creating one on first visit:
// the first registered user to arrive claims OWNER, everyone after is an EDITOR.
// Idempotent — returns the existing role if they're already a member.
//
// Race-safety leans on the partial unique index `room_one_owner` (migration
// 006): if two users try to claim ownership of a brand-new room simultaneously,
// one owner INSERT wins and the other hits a unique violation (23505), which we
// catch and downgrade to editor. No lock, no transaction needed.
export async function ensureMembership(
  roomId: string,
  userId: string,
): Promise<RoomRole> {
  const existing = await resolveRole(roomId, userId)
  if (existing) {
    return existing
  }

  try {
    await db
      .insertInto("room_members")
      .values({ room_id: roomId, user_id: userId, role: "owner" })
      .execute()
    return "owner"
  } catch (error) {
    if ((error as { code?: string }).code !== "23505") {
      throw error
    }
    // Owner already exists (or a concurrent claim won) — join as editor.
    await db
      .insertInto("room_members")
      .values({ room_id: roomId, user_id: userId, role: "editor" })
      .onConflict((oc) => oc.columns(["room_id", "user_id"]).doNothing())
      .execute()
    return (await resolveRole(roomId, userId)) ?? "editor"
  }
}
//#endregion

//#region Management
// All members of a room with their display info — for the owner's member panel.
export async function listMembers(roomId: string): Promise<RoomMember[]> {
  const rows = await db
    .selectFrom("room_members")
    .innerJoin("users", "users.id", "room_members.user_id")
    .select([
      "room_members.user_id as userId",
      "users.username as username",
      "users.color as color",
      "room_members.role as role",
    ])
    .where("room_members.room_id", "=", roomId)
    .orderBy("room_members.created_at", "asc")
    .execute()
  return rows.map((row) => ({ ...row, role: row.role as RoomRole }))
}

// TEST-ONLY assertion helper — deliberately kept despite having no production
// caller. Production never needs to count owners: the one-owner invariant is
// enforced structurally, by the `room_one_owner` partial unique index (migration
// 006) plus setRole's atomic transfer and removeMember's refusal to remove an
// owner. This exists so the tests can assert that invariant directly, which is
// worth more than the tidiness of deleting it.
export async function countOwners(roomId: string): Promise<number> {
  const row = await db
    .selectFrom("room_members")
    .select((eb) => eb.fn.countAll<string>().as("count"))
    .where("room_id", "=", roomId)
    .where("role", "=", "owner")
    .executeTakeFirst()
  return Number(row?.count ?? 0)
}

// Sets a member's role. A room has EXACTLY ONE owner (enforced by the
// room_one_owner partial unique index), which shapes two cases:
//
//   - Promoting someone to owner is an ownership TRANSFER: the current owner is
//     demoted to editor and the target promoted, in one transaction, so there's
//     never a moment with zero or two owners (which the index would reject).
//   - Demoting the owner directly is refused — that would leave the room with no
//     owner. The caller must transfer ownership instead.
//
// Returns false if the target isn't a member or the change was refused.
export async function setRole(
  roomId: string,
  userId: string,
  role: RoomRole,
): Promise<boolean> {
  const current = await resolveRole(roomId, userId)
  if (!current) {
    return false
  }
  if (current === role) {
    return true
  }

  if (role === "owner") {
    await db.transaction().execute(async (trx) => {
      // Demote the existing owner FIRST so the target's promotion doesn't
      // collide with the one-owner index.
      await trx
        .updateTable("room_members")
        .set({ role: "editor", updated_at: new Date() })
        .where("room_id", "=", roomId)
        .where("role", "=", "owner")
        .execute()
      await trx
        .updateTable("room_members")
        .set({ role: "owner", updated_at: new Date() })
        .where("room_id", "=", roomId)
        .where("user_id", "=", userId)
        .execute()
    })
    return true
  }

  // Non-owner target role: fine for an editor/viewer, but refuse if it would
  // orphan the room by demoting its only owner.
  if (current === "owner") {
    return false
  }

  await db
    .updateTable("room_members")
    .set({ role, updated_at: new Date() })
    .where("room_id", "=", roomId)
    .where("user_id", "=", userId)
    .execute()
  return true
}

export async function removeMember(
  roomId: string,
  userId: string,
): Promise<boolean> {
  const current = await resolveRole(roomId, userId)
  if (!current) {
    return false
  }
  // The owner can't be removed — transfer ownership first. This keeps the
  // one-owner invariant without a countOwners check (there's only ever one).
  if (current === "owner") {
    return false
  }
  await db
    .deleteFrom("room_members")
    .where("room_id", "=", roomId)
    .where("user_id", "=", userId)
    .execute()
  return true
}
//#endregion

//#region Dashboard
// Every room the user belongs to, newest-active first — the data behind the
// "My Rooms" dashboard.
export async function listRoomsForUser(userId: string): Promise<UserRoom[]> {
  const rows = await db
    .selectFrom("room_members")
    .innerJoin("rooms", "rooms.id", "room_members.room_id")
    .select([
      "rooms.id as roomId",
      "rooms.title as title",
      "room_members.role as role",
      "rooms.updated_at as updatedAt",
    ])
    .where("room_members.user_id", "=", userId)
    .orderBy("rooms.updated_at", "desc")
    .execute()
  return rows.map((row) => ({ ...row, role: row.role as RoomRole }))
}
//#endregion
