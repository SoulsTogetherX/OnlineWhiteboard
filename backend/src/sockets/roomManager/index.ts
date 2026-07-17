//#region Imports
import type { RawData, WebSocketServer } from "ws"

import { CANVAS_HEIGHT, CANVAS_WIDTH } from "@shared/constants/canvas"
import { loadCanvas, saveCanvas } from "@/db/canvasRepository"
import { applyDrawInstructionToCanvas } from "@shared/utils/handleCanvasProtocol"

import type { ClientSocket } from "@/types/ClientSocket"
import type {
  ClientSocketMessage,
  ServerSocketMessage,
} from "@shared/types/socketProtocol"
import type { DrawInstruction } from "@shared/types/drawProtocol"
//#endregion

//#region Constants
const SAVE_INTERVAL_MS = 15_000
const SNAPSHOT_INTERVAL_MS = 10_000
const HEARTBEAT_INTERVAL_MS = 30_000

// Cap on messages buffered while a room loads from Postgres (see addClient).
// A well-behaved client sends one ping and maybe a stroke or two in that
// window; anything past this is a client that isn't waiting for "ready", and
// buffering it without limit would be a memory-growth vector on a slow DB.
const MAX_PENDING_MESSAGES = 64
//#endregion

//#region Type Defs
type RoomState = {
  roomId: string
  clients: Set<ClientSocket>
  pixels: Uint8ClampedArray
  revision: number
  isDirty: boolean
  saveTimer: NodeJS.Timeout
  snapshotTimer: NodeJS.Timeout
}
//#endregion

//#region Room Manager
export default class RoomManager {
  private rooms = new Map<string, RoomState>()
  private heartbeatTimer?: NodeJS.Timeout

  constructor(private readonly wss: WebSocketServer) {}

  start(): void {
    this.heartbeatTimer = setInterval(() => {
      this.wss.clients.forEach((rawSocket) => {
        const socket = rawSocket as ClientSocket

        if (!socket.isAlive) {
          socket.terminate()
          return
        }

        socket.isAlive = false
        socket.ping()
      })
    }, HEARTBEAT_INTERVAL_MS)

    this.wss.on("close", () => {
      if (this.heartbeatTimer) {
        clearInterval(this.heartbeatTimer)
      }
    })
  }

  // Loading a room can hit Postgres, so this is async — and that `await` used
  // to sit BETWEEN the socket opening and its "message" listener being
  // attached. Anything the client sent in that window had no listener and was
  // silently dropped by ws.
  //
  // That is not a rare race. Clients ping the instant the socket opens, and a
  // room only loads from the database when it is NOT already cached — i.e. for
  // the first client into a room, every time. The dropped ping got no pong, the
  // client's 5s heartbeat timeout fired, it closed with code 4000 and
  // reconnected — and because it was the only client, leaving evicted the room
  // from the cache, so the next attempt was cold again and hit the same race.
  // A reconnect loop, and in production a user's first strokes vanishing.
  //
  // Fix: attach every listener synchronously, before any await, and buffer what
  // arrives until the room is ready.
  async addClient(socket: ClientSocket, roomId: string): Promise<void> {
    socket.roomId = roomId
    socket.isAlive = true
    socket.on("pong", () => {
      socket.isAlive = true
    })

    const pending: RawData[] = []
    let isReady = false

    socket.on("message", (raw) => {
      if (isReady) {
        void this.handleMessage(socket, raw)
        return
      }
      if (pending.length < MAX_PENDING_MESSAGES) {
        pending.push(raw)
      }
    })
    // Also registered before the await: a client that disconnects mid-load
    // would otherwise never fire removeClient, and the code below would add its
    // dead socket to the room — leaving a room that can never empty, with its
    // save/snapshot timers running forever.
    socket.on("close", () => void this.removeClient(socket))
    socket.on("error", (error) => {
      console.error("WebSocket client error:", error)
    })

    const room = await this.getOrCreateRoom(roomId)

    // The client may have gone away while we were loading. Don't add a dead
    // socket, and don't leave a freshly-created empty room behind holding
    // timers.
    if (socket.readyState !== socket.OPEN) {
      this.disposeIfEmpty(room)
      return
    }

    room.clients.add(socket)

    this.send(socket, {
      type: "ready",
      roomId,
      revision: room.revision,
      activeUsers: room.clients.size,
    })
    this.sendSnapshot(socket, room)
    this.broadcastPresence(room)

    // Drain in arrival order, then switch to handling inline. Draining before
    // flipping the flag would let a message that arrives mid-drain jump ahead
    // of the queue and apply out of order.
    isReady = true
    for (const raw of pending) {
      await this.handleMessage(socket, raw)
    }
  }

  private async getOrCreateRoom(roomId: string): Promise<RoomState> {
    const cached = this.rooms.get(roomId)
    if (cached) {
      return cached
    }

    const stored = await loadCanvas(roomId)
    const room: RoomState = {
      roomId,
      clients: new Set<ClientSocket>(),
      pixels: stored.pixels,
      revision: stored.revision,
      isDirty: false,
      saveTimer: setInterval(
        () => void this.saveRoom(roomId),
        SAVE_INTERVAL_MS,
      ),
      snapshotTimer: setInterval(
        () => this.broadcastRevisionCheck(roomId),
        SNAPSHOT_INTERVAL_MS,
      ),
    }

    this.rooms.set(roomId, room)
    return room
  }

  private async handleMessage(
    socket: ClientSocket,
    raw: RawData,
  ): Promise<void> {
    const message = this.parseMessage(raw)
    if (!message) {
      this.send(socket, { type: "error", message: "Invalid socket message." })
      return
    }

    if (message.type === "ping") {
      this.send(socket, { type: "pong", sentAt: message.sentAt })
      return
    }

    if (message.roomId !== socket.roomId) {
      this.send(socket, { type: "error", message: "Room mismatch." })
      return
    }

    const room = this.rooms.get(socket.roomId)
    if (!room) {
      this.send(socket, { type: "error", message: "Room is not loaded." })
      return
    }

    if (message.type === "resync") {
      this.sendSnapshot(socket, room)
      return
    }

    this.applyInstruction(room, message.instruction)
  }

  private parseMessage(raw: RawData): ClientSocketMessage | null {
    try {
      const text = Buffer.isBuffer(raw) ? raw.toString("utf8") : raw.toString()
      return JSON.parse(text) as ClientSocketMessage
    } catch {
      return null
    }
  }

  private applyInstruction(
    room: RoomState,
    instruction: DrawInstruction,
  ): void {
    const applied = applyDrawInstructionToCanvas(room.pixels, instruction)
    if (!applied) {
      return
    }

    room.revision += 1
    room.isDirty = true

    this.broadcast(room, {
      type: "draw",
      roomId: room.roomId,
      instruction: applied,
      revision: room.revision,
    })
  }

  private async removeClient(socket: ClientSocket): Promise<void> {
    const room = this.rooms.get(socket.roomId)
    if (!room) {
      return
    }

    room.clients.delete(socket)
    this.broadcastPresence(room)

    if (room.clients.size === 0) {
      await this.saveRoom(room.roomId)
      this.disposeIfEmpty(room)
    }
  }

  // Tears down a room's timers and drops it from the cache, but only if nobody
  // is left in it. Shared by removeClient and by addClient's mid-load bail-out,
  // so there is exactly one place that stops those intervals — an in-memory room
  // whose timers keep firing is a leak that survives every client leaving.
  private disposeIfEmpty(room: RoomState): void {
    if (room.clients.size > 0) {
      return
    }
    clearInterval(room.saveTimer)
    clearInterval(room.snapshotTimer)
    this.rooms.delete(room.roomId)
  }

  private async saveRoom(roomId: string): Promise<void> {
    const room = this.rooms.get(roomId)
    if (!room || !room.isDirty) {
      return
    }

    try {
      await saveCanvas(room.roomId, room.pixels, room.revision)
      room.isDirty = false
    } catch (error) {
      console.error(`Failed to save room ${room.roomId}:`, error)
    }
  }

  private broadcastPresence(room: RoomState): void {
    this.broadcast(room, {
      type: "presence",
      roomId: room.roomId,
      activeUsers: room.clients.size,
    })
  }

  private broadcastRevisionCheck(roomId: string): void {
    const room = this.rooms.get(roomId)
    if (!room) {
      return
    }
    this.broadcast(room, {
      type: "revision_check",
      roomId: room.roomId,
      revision: room.revision,
    })
  }

  private sendSnapshot(socket: ClientSocket, room: RoomState): void {
    this.send(socket, this.makeSnapshotMessage(room))
  }

  private makeSnapshotMessage(room: RoomState): ServerSocketMessage {
    return {
      type: "canvas_snapshot",
      roomId: room.roomId,
      revision: room.revision,
      width: CANVAS_WIDTH,
      height: CANVAS_HEIGHT,
      data: Buffer.from(room.pixels).toString("base64"),
    }
  }

  private broadcast(room: RoomState, message: ServerSocketMessage): void {
    const payload = JSON.stringify(message)
    room.clients.forEach((client) => this.sendRaw(client, payload))
  }

  private send(socket: ClientSocket, message: ServerSocketMessage): void {
    this.sendRaw(socket, JSON.stringify(message))
  }

  private sendRaw(socket: ClientSocket, payload: string): void {
    if (socket.readyState !== socket.OPEN) {
      return
    }
    socket.send(payload)
  }
}
//#endregion
