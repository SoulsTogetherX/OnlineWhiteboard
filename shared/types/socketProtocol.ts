//#region Imports
import type { DrawInstruction, ToolType } from "./drawProtocol"
import type { Participant, RoomRole } from "./identity"
import type { Vec } from "./primitive"
//#endregion

//#region Cursor tool
// What a cursor can be holding. The drawing tools, plus the eyedropper — which
// produces no draw instruction, so it is not a ToolType, but IS something other
// people can watch you use.
//
// It lives in the socket protocol rather than in the frontend because it now
// travels between clients, and the two sides have to agree on the spelling.
// "grabber" is here but is NOT a ToolType: it draws nothing, it changes what
// dragging the canvas means. It still belongs on a cursor, because someone
// holding it is about to move the view rather than mark the board, and that is
// worth seeing.
export type CursorTool = ToolType | "eyedropper" | "grabber"

export const CURSOR_TOOLS: readonly CursorTool[] = [
  "pencil",
  "eraser",
  "bucket",
  "spray",
  "blur",
  "eyedropper",
  "grabber",
] as const
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
      // Which tool this pointer is holding, so other people's cursors show what
      // someone is about to do rather than a generic arrow. Optional: a client
      // that omits it still gets a cursor, drawn with the default glyph.
      tool?: CursorTool
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
      // Resize the room's canvas. OWNER ONLY. Crop/pad from the top-left
      // (§16 — lossless for the kept region, unlike resampling), then broadcast
      // a fresh snapshot so every client adopts the new size. width/height must
      // be within [MIN_CANVAS_DIMENSION, MAX_CANVAS_DIMENSION]; the server
      // validates and ignores a no-op (same size).
      type: "resize"
      roomId: string
      width: number
      height: number
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

// How a snapshot frame's payload is encoded. "deflate-raw" is raw DEFLATE with
// no gzip/zlib wrapper — the frame header already identifies the payload, so a
// wrapper would be pure overhead, and the browser's DecompressionStream speaks
// it natively.
//
// Compression is applied to the payload ONLY, never to the transport. See
// backend/src/sockets/snapshotCompression.ts and CLAUDE.md §16 for why
// permessage-deflate stays off.
export type SnapshotCompression = "none" | "deflate-raw"

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
      // Sent as a BINARY frame, not text: this object is the frame's JSON
      // header and the RGBA pixels are the frame's payload (see
      // shared/utils/binaryFrame.ts). Base64 inside JSON inflated the canvas by
      // a third — 57,600 B became 76,800 chars — and cost a per-byte decode
      // loop on the client, for a transport that has always been binary-capable.
      //
      // There is deliberately no `data` field. The pixels are not part of the
      // header, so nothing can accidentally serialise them back into JSON.
      //
      // `compression` describes the payload. It is a header FIELD rather than a
      // second frame layout, which is the whole reason the envelope carries a
      // JSON header: adding compression cost no format change and no version
      // bump. The server picks per snapshot and may answer "none" when
      // compressing would have made the payload bigger.
      type: "canvas_snapshot"
      roomId: string
      revision: number
      width: number
      height: number
      compression: SnapshotCompression
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
      tool?: CursorTool
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
      //
      // Still TEXT, unlike canvas_snapshot. The binary envelope carries one bulk
      // payload behind a small header, and `steps` is neither small nor bulk —
      // it is an unbounded list that would have to live in the header, where the
      // u16 length field cannot hold it. Playback is also a rare, user-initiated
      // request rather than something every client receives on join, so the
      // bandwidth argument that motivated binary snapshots barely applies.
      type: "playback"
      roomId: string
      base: string
      baseRevision: number
      // The dimensions the base canvas (and the steps) are in, so the viewer
      // animates at the right size for a resized room.
      width: number
      height: number
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
