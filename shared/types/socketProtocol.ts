//#region Imports
import type { DrawInstruction } from "./drawProtocol"
import type { Participant, RoomRole } from "./identity"
import type { Vec } from "./primitive"
//#endregion

//#region Socket Message Types
export type ClientSocketMessage =
  | {
      type: "draw"
      roomId: string
      instruction: DrawInstruction
    }
  | {
      type: "ping"
      sentAt: number
    }
  | {
      type: "resync"
      roomId: string
    }
  | {
      // The client's cursor position in canvas coordinates, or null when the
      // pointer leaves the canvas. High-frequency and ephemeral: the server
      // relays it and forgets it — never applied to the canvas, never logged,
      // never persisted.
      type: "cursor"
      roomId: string
      pos: Vec | null
    }
  | {
      // A room-wide destructive action, applied immediately. OWNER ONLY.
      // Why a single accountable owner rather than group consensus is recorded
      // in CLAUDE.md's decision record.
      type: "room_action"
      roomId: string
      action: RoomAction
    }
  | {
      // Take ownership of a room that has none. Signed-in visitors only, and
      // only while the room is unowned — ownership is opt-in, never assigned
      // automatically, and persists across sessions once claimed.
      type: "claim_ownership"
      roomId: string
    }
  | {
      // Give up ownership, leaving the room unowned so somebody else can claim
      // it. OWNER ONLY (it is a no-op for anyone else by construction).
      //
      // The releasing owner becomes an EDITOR, not a viewer: they are handing
      // back a crown, not asking to be locked out of a board they have been
      // running. Dropping them to viewer would mean releasing ownership could
      // silently cost them the ability to draw in their own locked room.
      type: "release_ownership"
      roomId: string
    }
  | {
      // Turn open editing on or off. OWNER ONLY. When off, only owner/editor
      // may draw; when on, viewers and guests may too.
      type: "set_open_editing"
      roomId: string
      enabled: boolean
    }
  | {
      // A signed-in viewer asking the owner for editor access. Meaningless from
      // a guest (no account to promote) or from someone who already has it.
      type: "request_editor"
      roomId: string
    }
  | {
      // The owner's answer to a pending request. OWNER ONLY.
      type: "respond_editor"
      roomId: string
      userId: string
      approve: boolean
    }
  | {
      // Directly set a member's role. OWNER ONLY. Promoting someone to owner is
      // an ownership TRANSFER — the current owner becomes an editor in the same
      // transaction, because a room has exactly one owner.
      type: "set_member_role"
      roomId: string
      userId: string
      role: RoomRole
    }
  | {
      // Save the current canvas as a named, durable version. Editors only.
      type: "create_checkpoint"
      roomId: string
      name: string
    }
  | {
      // Jump the live canvas back to a saved version. Editors only; broadcast to
      // everyone as a fresh snapshot.
      type: "restore_checkpoint"
      roomId: string
      checkpointId: string
    }
  | {
      // Delete a saved version. Editors only.
      type: "delete_checkpoint"
      roomId: string
      checkpointId: string
    }
  | {
      // Ask for the data to animate history: a base canvas plus the events after
      // it. `fromCheckpointId` chooses the starting point; omitted means "the
      // earliest history the server still retains".
      type: "request_playback"
      roomId: string
      fromCheckpointId?: string
    }

// Room-wide destructive actions, owner-only. Kept as its own type so resize
// slots in beside clear without touching the message shapes.
export type RoomAction = "clear"

// A pending request for editor access, as shown to the owner. Carries the
// account id (the owner needs it to answer) and the display name to show.
export type EditorRequest = {
  userId: string
  name: string
}

// A saved version's metadata as seen by clients (no pixel bytes — those are only
// materialised on restore/playback). createdAt is an ISO string over the wire.
export type CheckpointInfo = {
  id: string
  name: string
  revision: number
  createdAt: string
}

// One step in a playback: the instruction that was applied and the revision it
// produced. The client animates by applying these onto the base in order.
export type PlaybackStep = {
  revision: number
  instruction: DrawInstruction
}

export type ServerSocketMessage =
  | {
      type: "ready"
      roomId: string
      revision: number
      // The room's permission state, sent with the very first message so the
      // client never renders a toolbar before it knows what this connection is
      // allowed to do. Without it there is a window where the UI shows drawing
      // tools that the server would reject.
      openEditing: boolean
      hasOwner: boolean
      // Who the server decided this connection is (account or guest), plus the
      // current roster. `self` lets a guest client learn its generated name and
      // colour, which it has no other way of knowing.
      self: Participant
      participants: Participant[]
    }
  | {
      type: "draw"
      roomId: string
      instruction: DrawInstruction
      revision: number
    }
  | {
      type: "canvas_snapshot"
      roomId: string
      revision: number
      width: number
      height: number
      data: string
    }
  | {
      // Tiny periodic heartbeat replacing the old full-canvas broadcast.
      // Clients compare this to their own last-applied revision and only
      // ask for a real snapshot (via "resync") if they've actually fallen
      // behind — so the common case costs a few dozen bytes, not the whole
      // canvas, and that cost doesn't grow with canvas size at all.
      type: "revision_check"
      roomId: string
      revision: number
    }
  | {
      // Broadcast whenever the roster changes (someone joins or leaves). Carries
      // the full participant list; the client derives the count from its length.
      type: "presence"
      roomId: string
      participants: Participant[]
    }
  | {
      // A relayed cursor from another connection. The client already has each
      // participant's colour and name from the roster, so this carries only the
      // connectionId to look them up by, and the position.
      type: "cursor"
      roomId: string
      connectionId: string
      pos: Vec | null
    }
  | {
      // The room's permission state. Sent on join and broadcast whenever it
      // changes, so every client can grey out controls using the same facts the
      // server enforces with.
      type: "room_settings"
      roomId: string
      openEditing: boolean
      hasOwner: boolean
    }
  | {
      // Pending editor requests. Sent ONLY to the owner — the list names people
      // who want promoting, and nobody else has any use for it or any right to
      // it. Ephemeral: requests live in memory and disappear when the requester
      // disconnects, because a request from someone who has left is noise.
      type: "editor_requests"
      roomId: string
      requests: EditorRequest[]
    }
  | {
      // This connection's own identity changed — almost always its role, after
      // claiming ownership or being promoted. Sent only to the affected socket;
      // everyone else learns the same thing from the presence broadcast.
      type: "role_changed"
      roomId: string
      self: Participant
    }
  | {
      // The room's saved versions. Sent on join and whenever the list changes
      // (a checkpoint is created, restored-from, or deleted).
      type: "checkpoints"
      roomId: string
      checkpoints: CheckpointInfo[]
    }
  | {
      // The data to animate history, sent only to the requester: a base canvas
      // (base64 RGBA) at baseRevision, plus the ordered events to replay onto it.
      type: "playback"
      roomId: string
      base: string
      baseRevision: number
      steps: PlaybackStep[]
    }
  | {
      type: "pong"
      sentAt: number
    }
  | {
      type: "error"
      message: string
    }
//#endregion
