//#region Imports
import type { RawData, WebSocketServer } from "ws"

import { CANVAS_HEIGHT, CANVAS_WIDTH } from "@shared/constants/canvas"
import { loadCanvas, saveCanvas } from "@/db/canvasRepository"
import { applyDrawInstruction } from "@/utils/canvasActions"

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

  async addClient(socket: ClientSocket, roomId: string): Promise<void> {
    socket.roomId = roomId
    socket.isAlive = true
    socket.on("pong", () => {
      socket.isAlive = true
    })

    const room = await this.getOrCreateRoom(roomId)
    room.clients.add(socket)

    socket.on("message", (raw) => void this.handleMessage(socket, raw))
    socket.on("close", () => void this.removeClient(socket))
    socket.on("error", (error) => {
      console.error("WebSocket client error:", error)
    })

    this.send(socket, {
      type: "ready",
      roomId,
      revision: room.revision,
      activeUsers: room.clients.size,
    })
    this.sendSnapshot(socket, room)
    this.broadcastPresence(room)
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
        () => this.broadcastSnapshot(roomId),
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

    this.applyAction(room, message.action)
  }

  private parseMessage(raw: RawData): ClientSocketMessage | null {
    try {
      const text = Buffer.isBuffer(raw) ? raw.toString("utf8") : raw.toString()
      return JSON.parse(text) as ClientSocketMessage
    } catch {
      return null
    }
  }

  private applyAction(room: RoomState, action: DrawInstruction): void {
    applyDrawInstruction(room.pixels, action)
    room.revision += 1
    room.isDirty = true

    this.broadcast(room, {
      type: "draw",
      roomId: room.roomId,
      action,
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
      clearInterval(room.saveTimer)
      clearInterval(room.snapshotTimer)
      this.rooms.delete(room.roomId)
    }
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

  private broadcastSnapshot(roomId: string): void {
    const room = this.rooms.get(roomId)
    if (!room) {
      return
    }
    this.broadcast(room, this.makeSnapshotMessage(room))
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
    room.clients.forEach((client) => this.send(client, message))
  }

  private send(socket: ClientSocket, message: ServerSocketMessage): void {
    if (socket.readyState !== socket.OPEN) {
      return
    }
    socket.send(JSON.stringify(message))
  }
}
//#endregion
