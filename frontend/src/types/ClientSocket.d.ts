//#region Type Defs
export interface ClientSocket extends WebSocket {
  isAlive: boolean
  roomId: string
}
//#endregion
