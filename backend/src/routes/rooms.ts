//#region Imports
import type { Express } from "express"

import { createRequireUser } from "@/auth/requireUser"
import {
  listMembers,
  listRoomsForUser,
  removeMember,
  resolveRole,
  setRole,
} from "@/db/roomMembersRepository"
import { loadCanvas } from "@/db/canvasRepository"
import { CANVAS_HEIGHT, CANVAS_WIDTH } from "@shared/constants/canvas"
import { ROLES, canManageRoom } from "@shared/types/identity"

import type { RoomRole } from "@shared/types/identity"
//#endregion

//#region Validation
// ROLES is the shared list, so this validation and the client's role dropdown
// are driven by the same source and cannot disagree about what roles exist.
function isValidRole(input: unknown): input is RoomRole {
  return typeof input === "string" && (ROLES as readonly string[]).includes(input)
}
//#endregion

//#region Routes
// Room membership + role management. All routes require a live session; roles
// are an account feature (guests aren't members). Ownership actions require the
// caller to actually be the room's owner — checked here, not trusted from the
// client.
const requireUser = createRequireUser("Log in to manage rooms.")

export default function configureRoomRoutes(app: Express): void {
  // --- My rooms (dashboard) --------------------------------------------------
  app.get("/api/rooms", async (req, res) => {
    const user = await requireUser(req, res)
    if (!user) return
    res.json({ rooms: await listRoomsForUser(user.id) })
  })

  // --- Room thumbnail (latest snapshot) --------------------------------------
  // Returns the room's current pixels as base64 RGBA — the same bytes the
  // WebSocket sends on join, but over HTTP so the dashboard can render a
  // thumbnail per room without opening a socket to each. Member-gated: you can
  // only preview rooms you belong to. The CLIENT turns the bytes into an image
  // (drawing them onto a canvas), so the server needs no PNG encoder.
  app.get("/api/rooms/:roomId/snapshot", async (req, res) => {
    const user = await requireUser(req, res)
    if (!user) return
    const { roomId } = req.params

    const role = await resolveRole(roomId, user.id)
    if (!role) {
      return res.status(403).json({ error: "You are not a member of this room." })
    }

    const { pixels, revision } = await loadCanvas(roomId)
    res.json({
      width: CANVAS_WIDTH,
      height: CANVAS_HEIGHT,
      revision,
      data: Buffer.from(pixels).toString("base64"),
    })
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
    if (!callerRole || !canManageRoom(callerRole)) {
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
    if (!callerRole || !canManageRoom(callerRole)) {
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
