//#region Imports
import WebSocket from "ws"
//#endregion

//#region Type Defs
export interface ClientSocket extends WebSocket {
  isAlive: boolean
  roomId: string
}
//#endregion
