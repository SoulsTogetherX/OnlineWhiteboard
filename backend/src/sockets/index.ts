//#region Imports
import { IncomingMessage, Server } from "http"
import WebSocket, { WebSocketServer } from "ws"

import RoomManager from "./roomManager"

import type { ClientSocket } from "@/types/ClientSocket"
//#endregion

//#region Exported Methods
export default function configure(wss: WebSocketServer, server: Server) {
  const roomManager = new RoomManager(wss)
  roomManager.start()

  server.on("upgrade", (request, socket, head) => {
    const url = new URL(request.url ?? "", "http://localhost")

    if (url.pathname !== "/ws") {
      socket.destroy()
      return
    }

    const roomId = url.searchParams.get("roomId")?.trim()
    if (!roomId) {
      socket.destroy()
      return
    }

    wss.handleUpgrade(request, socket, head, (ws) => {
      wss.emit("connection", ws, request)
    })
  })

  wss.on("connection", (ws: WebSocket, request: IncomingMessage) => {
    const url = new URL(request.url ?? "", "http://localhost")
    const roomId = url.searchParams.get("roomId")?.trim()
    if (!roomId) {
      ws.close(1008, "Missing roomId")
      return
    }

    void roomManager.addClient(ws as ClientSocket, roomId)
  })
}
//#endregion
