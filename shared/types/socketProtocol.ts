//#region Imports
import type { DrawInstruction } from "./drawProtocol"
import type { Participant } from "./identity"
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
      // Request a room-wide destructive action (currently only "clear"). If the
      // requester is the only recent editor the server applies it immediately;
      // otherwise it opens a vote among the recent editors.
      type: "request_action"
      roomId: string
      action: RoomAction
    }
  | {
      // A recent editor's vote on an open request. The server tallies these and
      // resolves the vote when everyone has approved (or anyone rejects).
      type: "vote"
      roomId: string
      voteId: string
      approve: boolean
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

// Room-wide actions that require consensus. Kept as its own type so resize
// (P1d) slots in beside clear without touching the message shapes.
export type RoomAction = "clear"

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
      // A vote has opened. Sent to every recent editor (the voters). `voters` is
      // the number whose approval is needed; the initiator is counted as already
      // approving. `deadline` is an epoch-ms timestamp after which it auto-fails.
      type: "vote_started"
      roomId: string
      voteId: string
      action: RoomAction
      initiatorName: string
      voters: number
      approvals: number
      deadline: number
    }
  | {
      // Running tally as votes come in.
      type: "vote_update"
      roomId: string
      voteId: string
      voters: number
      approvals: number
    }
  | {
      // The vote ended. `approved` true means the action was applied (the canvas
      // change arrives separately as the normal "draw"/"clear" broadcast).
      type: "vote_resolved"
      roomId: string
      voteId: string
      approved: boolean
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
