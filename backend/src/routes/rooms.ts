//#region Imports
import type { Express, Request, Response } from "express"

import { readSessionToken, resolveSessionUser } from "@/auth/session"
import {
  listMembers,
  listRoomsForUser,
  removeMember,
  resolveRole,
  setRole,
} from "@/db/roomMembersRepository"

import type { User } from "@/db/userRepository"
import type { RoomRole } from "@shared/types/identity"
//#endregion

//#region Validation
const ROLES: readonly RoomRole[] = ["owner", "editor", "viewer"]
function isValidRole(input: unknown): input is RoomRole {
  return typeof input === "string" && (ROLES as readonly string[]).includes(input)
}
//#endregion

//#region Routes
// Room membership + role management. All routes require a live session; roles
// are an account feature (guests aren't members). Ownership actions require the
// caller to actually be the room's owner — checked here, not trusted from the
// client.
export default function configureRoomRoutes(app: Express): void {
  async function requireUser(
    req: Request,
    res: Response,
  ): Promise<User | null> {
    const user = await resolveSessionUser(readSessionToken(req))
    if (!user) {
      res.status(401).json({ error: "Log in to manage rooms." })
      return null
    }
    return user
  }

  // --- My rooms (dashboard) --------------------------------------------------
  app.get("/api/rooms", async (req, res) => {
    const user = await requireUser(req, res)
    if (!user) return
    res.json({ rooms: await listRoomsForUser(user.id) })
  })

  // --- Members of a room -----------------------------------------------------
  app.get("/api/rooms/:roomId/members", async (req, res) => {
    const user = await requireUser(req, res)
    if (!user) return
    const { roomId } = req.params

    // Only members can see the member list.
    const role = await resolveRole(roomId, user.id)
    if (!role) {
      return res.status(403).json({ error: "You are not a member of this room." })
    }
    res.json({ role, members: await listMembers(roomId) })
  })

  // --- Change a member's role (owner only) -----------------------------------
  app.put("/api/rooms/:roomId/members/:userId", async (req, res) => {
    const user = await requireUser(req, res)
    if (!user) return
    const { roomId, userId } = req.params
    const role = req.body?.role

    if (!isValidRole(role)) {
      return res.status(400).json({ error: "Invalid role." })
    }
    const callerRole = await resolveRole(roomId, user.id)
    if (callerRole !== "owner") {
      return res.status(403).json({ error: "Only the owner can change roles." })
    }

    const ok = await setRole(roomId, userId, role)
    if (!ok) {
      // Refused: target isn't a member, or it would leave the room ownerless.
      return res
        .status(409)
        .json({ error: "Cannot change that role (a room must keep an owner)." })
    }
    res.json({ members: await listMembers(roomId) })
  })

  // --- Remove a member (owner only) ------------------------------------------
  app.delete("/api/rooms/:roomId/members/:userId", async (req, res) => {
    const user = await requireUser(req, res)
    if (!user) return
    const { roomId, userId } = req.params

    const callerRole = await resolveRole(roomId, user.id)
    if (callerRole !== "owner") {
      return res.status(403).json({ error: "Only the owner can remove members." })
    }

    const ok = await removeMember(roomId, userId)
    if (!ok) {
      return res
        .status(409)
        .json({ error: "Cannot remove that member (a room must keep an owner)." })
    }
    res.json({ members: await listMembers(roomId) })
  })
}
//#endregion
