//#region Imports
import type { DrawInstruction } from "./drawProtocol"
//#endregion

//#region Socket Message Types
export type ClientSocketMessage =
  | {
      type: "draw"
      roomId: string
      action: DrawInstruction
    }
  | {
      type: "ping"
      sentAt: number
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
      action: DrawInstruction
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
