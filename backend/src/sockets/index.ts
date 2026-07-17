//#region Imports
import { IncomingMessage, Server } from "http"
import WebSocket, { WebSocketServer } from "ws"

import RoomManager from "./roomManager"

import type { ClientSocket } from "@/types/ClientSocket"
//#endregion

//#region Exported Methods
// Returns the RoomManager so the caller can drive graceful shutdown (flush
// buffered events + snapshot every room on SIGTERM). Nothing else needs it.
export default function configure(
  wss: WebSocketServer,
  server: Server,
): RoomManager {
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

    // addClient is async and hits Postgres (loadCanvas). `void`-ing it here
    // meant any DB failure surfaced as an unhandled rejection, which Node
    // treats as fatal — so one client failing to join killed the whole process
    // and disconnected every user in every room. Catching it keeps the blast
    // radius at the one socket that actually failed.
    //
    // 1011 = "internal error" in the WebSocket close-code registry. The client's
    // autoReconnect (useWebSocket) then retries with backoff, so a transient DB
    // blip self-heals instead of taking the server down.
    roomManager.addClient(ws as ClientSocket, roomId).catch((error) => {
      console.error(`Failed to add client to room "${roomId}":`, error)
      ws.close(1011, "Failed to join room")
    })
  })

  return roomManager
}
//#endregion
