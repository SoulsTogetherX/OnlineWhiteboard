//#region Imports
import { IncomingMessage, Server } from "http"
import WebSocket, { WebSocketServer } from "ws"

import RoomManager from "./roomManager"
import { resolveConnectionIdentity } from "@/auth/connectionIdentity"
import { isAllowedOrigin } from "@/security/origin"
import { ConnectionCounter, connectionKey } from "@/security/socketLimits"
import { MAX_ROOM_ID_LENGTH } from "@shared/constants/protocol"

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

  // Caps concurrent sockets per identity, so the per-socket rate limiter can't
  // be sidestepped by simply opening more sockets.
  const connections = new ConnectionCounter()

  server.on("upgrade", (request, socket, head) => {
    const url = new URL(request.url ?? "", "http://localhost")

    if (url.pathname !== "/ws") {
      socket.destroy()
      return
    }

    // Cross-Site WebSocket Hijacking defence. The handshake carries the visitor's
    // session cookie, and SameSite does not reliably cover WebSocket upgrades, so
    // without this any origin could open an authenticated socket AS the visitor
    // and act under their identity. Reject a browser upgrade from an origin we
    // don't recognise before it ever becomes a WebSocket.
    if (!isAllowedOrigin(request.headers.origin)) {
      console.warn(`Rejected WS upgrade from origin: ${request.headers.origin}`)
      socket.destroy()
      return
    }

    const roomId = url.searchParams.get("roomId")?.trim()
    // Bound the room id here as well as in the message envelope. This is the
    // path that CREATES a room row, so an unbounded id here is an unbounded
    // database write, not just an unbounded string.
    if (!roomId || roomId.length > MAX_ROOM_ID_LENGTH) {
      socket.destroy()
      return
    }

    // Enforce the connection cap BEFORE handing off to the connection handler,
    // which resolves identity against Postgres. A cap that only applies after a
    // database query is a cap an attacker can use to generate database queries.
    const { key, isAuthenticated } = connectionKey(request)
    if (!connections.tryAcquire(key, isAuthenticated)) {
      console.warn(`Connection cap reached for ${key}`)
      socket.destroy()
      return
    }

    wss.handleUpgrade(request, socket, head, (ws) => {
      // Release on close, whatever the reason — a slot leaked here would
      // permanently shrink that client's allowance until the process restarts.
      ws.once("close", () => connections.release(key))
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

    // Resolve who this connection is (logged-in user via the session cookie, or
    // a generated guest) BEFORE joining, attach it to the socket, then add to
    // the room. Both steps hit Postgres and are async.
    //
    // addClient/`resolveConnectionIdentity` failures are caught here. `void`-ing
    // them would surface as an unhandled rejection, which Node treats as fatal —
    // so one client failing to join used to kill the whole process and drop
    // every user in every room. Catching keeps the blast radius at the one
    // socket. 1011 = "internal error"; the client's autoReconnect then retries
    // with backoff, so a transient DB blip self-heals.
    resolveConnectionIdentity(request)
      .then(({ identity, userId }) => {
        const socket = ws as ClientSocket
        socket.connectionId = identity.connectionId
        socket.identity = identity
        // Server-side only, never broadcast — used to resolve this connection's
        // room role (see RoomManager.addClient).
        socket.userId = userId
        return roomManager.addClient(socket, roomId)
      })
      .catch((error) => {
        console.error(`Failed to add client to room "${roomId}":`, error)
        ws.close(1011, "Failed to join room")
      })
  })

  return roomManager
}
//#endregion
