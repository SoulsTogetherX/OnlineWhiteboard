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

// Ensures the user has a membership in the room, creating one on first visit as
// a VIEWER. Idempotent — returns the existing role if they're already a member.
//
// Everyone starts as a viewer, including the very first person to open a brand
// new room. Ownership is never assigned automatically; it is claimed
// deliberately (see claimOwnership). The previous behaviour — first signed-in
// visitor silently becomes owner, everyone after becomes editor — meant simply
// opening a link handed you powers you never asked for and never saw mentioned,
// and it made ownership a race rather than a choice.
export async function ensureMembership(
  roomId: string,
  userId: string,
): Promise<RoomRole> {
  const existing = await resolveRole(roomId, userId)
  if (existing) {
    return existing
  }

  await db
    .insertInto("room_members")
    .values({ room_id: roomId, user_id: userId, role: "viewer" })
    .onConflict((oc) => oc.columns(["room_id", "user_id"]).doNothing())
    .execute()

  // Re-read rather than assuming: a concurrent insert may have won the
  // onConflict, and that row is the truth.
  return (await resolveRole(roomId, userId)) ?? "viewer"
}

// Takes ownership of a room that has none. Returns "owner" on success, or null
// if the room already has an owner.
//
// Race-safety leans entirely on the partial unique index `room_one_owner`
// rather than on a read-then-write: two people clicking "claim" at the same
// instant both pass any check-first test, but only one INSERT/UPDATE can
// survive the index, and the loser gets 23505. No lock, no transaction, no
// window.
export async function claimOwnership(
  roomId: string,
  userId: string,
): Promise<RoomRole | null> {
  try {
    await db
      .insertInto("room_members")
      .values({ room_id: roomId, user_id: userId, role: "owner" })
      .onConflict((oc) =>
        oc
          .columns(["room_id", "user_id"])
          .doUpdateSet({ role: "owner", updated_at: new Date() }),
      )
      .execute()
    return "owner"
  } catch (error) {
    if ((error as { code?: string }).code === "23505") {
      // Someone else already owns it.
      return null
    }
    throw error
  }
}

// Gives up ownership, leaving the room unowned. Returns true if this user was
// the owner and has been stepped down.
//
// The `role = 'owner'` predicate in the WHERE clause is the authorisation: a
// non-owner's UPDATE matches zero rows and changes nothing, so there is no
// check-then-write window for two requests to slip through.
//
// They become an EDITOR rather than a viewer, so handing back the crown never
// silently costs them the ability to draw in a room they had locked.
//
// Note this deliberately does what setRole REFUSES to do — leave a room with no
// owner. There it would be an accident that orphans a room; here it is the
// entire point, which is why it is a separate function rather than a flag.
export async function releaseOwnership(
  roomId: string,
  userId: string,
): Promise<boolean> {
  const result = await db
    .updateTable("room_members")
    .set({ role: "editor", updated_at: new Date() })
    .where("room_id", "=", roomId)
    .where("user_id", "=", userId)
    .where("role", "=", "owner")
    .executeTakeFirst()
  return Number(result.numUpdatedRows ?? 0n) > 0
}

export async function roomHasOwner(roomId: string): Promise<boolean> {
  const row = await db
    .selectFrom("room_members")
    .select("user_id")
    .where("room_id", "=", roomId)
    .where("role", "=", "owner")
    .executeTakeFirst()
  return Boolean(row)
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
  // one-owner invariant without needing to count owners (there's only ever one,
  // guaranteed by the room_one_owner partial unique index).
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
