//#region Imports
import type { DrawInstruction } from "./drawProtocol"
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

export type ServerSocketMessage =
  | {
      type: "ready"
      roomId: string
      revision: number
      activeUsers: number
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
      type: "presence"
      roomId: string
      activeUsers: number
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
