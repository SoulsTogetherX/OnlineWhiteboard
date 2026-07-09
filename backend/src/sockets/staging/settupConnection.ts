//#region Imports
import { WebSocketServer } from "ws"
//#endregion

//#region Connection Methods
export default function settupConnection(wss: WebSocketServer) {
  wss.on("connection", (ws, req) => {
    console.log("client connected", req.url)

    ws.on("message", (msg) => {
      console.log("message:", msg.toString())
    })
  })
}
//#endregion
