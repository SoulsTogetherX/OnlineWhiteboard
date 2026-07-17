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
      type: "pong"
      sentAt: number
    }
  | {
      type: "error"
      message: string
    }
//#endregion
