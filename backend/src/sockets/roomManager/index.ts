//#region Imports
import type { RawData, WebSocketServer } from "ws"

import { CANVAS_HEIGHT, CANVAS_WIDTH } from "@shared/constants/canvas"
import { loadCanvas, saveCanvas } from "@/db/canvasRepository"
import {
  appendDrawEvents,
  ensureRoom,
  loadEventsSince,
  type DrawEvent,
} from "@/db/eventRepository"
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

// How often buffered draw events are flushed to the log. This is the durability
// knob: a hard crash loses at most the events buffered since the last flush, so
// ~250ms bounds worst-case loss to well under a second (vs the 15s snapshot
// interval before the event log existed). Smaller = more durable but more
// frequent tiny INSERTs; this is the balance point for interactive drawing.
const FLUSH_INTERVAL_MS = 250

// Flush early if the buffer grows past this between ticks, so a burst (e.g. a
// fast scribble, or many users in one room) can't build an unbounded backlog or
// stretch the loss window beyond one batch.
const MAX_EVENT_BUFFER = 200

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
  flushTimer: NodeJS.Timeout
  // Applied instructions awaiting their batched write to draw_events.
  eventBuffer: DrawEvent[]
  // Guards against a flush starting while the previous one is still in flight
  // (the timer can fire again mid-await).
  isFlushing: boolean
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

    // Recovery: start from the latest snapshot, then replay every event newer
    // than it. On a clean run there are no such events and this is just the
    // snapshot; after a crash, these are the strokes drawn since the last
    // checkpoint — the difference between losing <1s of work and losing 15s.
    const stored = await loadCanvas(roomId)
    let revision = stored.revision

    const events = await loadEventsSince(roomId, stored.revision)
    for (const event of events) {
      // The SAME shared, unit-tested function the live path uses. Replay is just
      // "apply these instructions in order" — deterministic because they carry a
      // monotonic revision and follow a known snapshot.
      applyDrawInstructionToCanvas(stored.pixels, event.instruction)
      revision = event.revision
    }
    if (events.length > 0) {
      console.log(
        `recovered room ${roomId}: replayed ${events.length} event(s) ` +
          `past snapshot revision ${stored.revision} -> ${revision}`,
      )
    }

    // Guarantee the FK target for draw_events exists before the first flush.
    await ensureRoom(roomId)

    const room: RoomState = {
      roomId,
      clients: new Set<ClientSocket>(),
      pixels: stored.pixels,
      revision,
      isDirty: false,
      eventBuffer: [],
      isFlushing: false,
      saveTimer: setInterval(
        () => void this.saveRoom(roomId),
        SAVE_INTERVAL_MS,
      ),
      snapshotTimer: setInterval(
        () => this.broadcastRevisionCheck(roomId),
        SNAPSHOT_INTERVAL_MS,
      ),
      flushTimer: setInterval(
        () => void this.flushEvents(roomId),
        FLUSH_INTERVAL_MS,
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

    // Record the APPLIED instruction (for a patch, the narrowed subset that
    // actually landed) against the revision it produced. This is what makes the
    // log replay to the exact same pixels — the broadcast below sends clients
    // the same `applied` value.
    room.eventBuffer.push({ revision: room.revision, instruction: applied })
    if (room.eventBuffer.length >= MAX_EVENT_BUFFER) {
      void this.flushEvents(room.roomId)
    }

    this.broadcast(room, {
      type: "draw",
      roomId: room.roomId,
      instruction: applied,
      revision: room.revision,
    })
  }

  // Writes the room's buffered events to the log in one batch. Kept safe against
  // overlap (the flush timer can fire while a previous flush is still awaiting)
  // by an isFlushing guard, and against loss by putting a failed batch back at
  // the front of the buffer to retry on the next tick.
  private async flushEvents(roomId: string): Promise<void> {
    const room = this.rooms.get(roomId)
    if (!room || room.isFlushing || room.eventBuffer.length === 0) {
      return
    }

    room.isFlushing = true
    // Take the current buffer and clear it so new events accumulate separately
    // while this batch is in flight.
    const batch = room.eventBuffer.splice(0, room.eventBuffer.length)

    try {
      await appendDrawEvents(roomId, batch)
    } catch (error) {
      console.error(`Failed to flush events for room ${roomId}:`, error)
      // Return the unwritten events to the head of the buffer, preserving order,
      // so the next flush retries them. Idempotent append (ON CONFLICT DO
      // NOTHING) means a partial success followed by a retry can't duplicate.
      room.eventBuffer.unshift(...batch)
    } finally {
      room.isFlushing = false
    }
  }

  private async removeClient(socket: ClientSocket): Promise<void> {
    const room = this.rooms.get(socket.roomId)
    if (!room) {
      return
    }

    room.clients.delete(socket)
    this.broadcastPresence(room)

    if (room.clients.size === 0) {
      // Flush buffered events BEFORE the snapshot and before eviction —
      // otherwise the last sub-second of drawing in a room that just emptied
      // would be dropped when its buffer is discarded.
      await this.flushEvents(room.roomId)
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
    clearInterval(room.flushTimer)
    this.rooms.delete(room.roomId)
  }

  // Graceful shutdown: on SIGTERM/SIGINT, flush every room's buffered events and
  // write a final snapshot before the process exits. Without this, `docker stop`
  // (and every deploy, which is a stop + start) would drop whatever was buffered
  // since the last flush — the one window the event log can't recover on its
  // own, because those events never reached the database. Timers are cleared so
  // nothing reschedules while we drain.
  async shutdown(): Promise<void> {
    clearInterval(this.heartbeatTimer)
    for (const room of this.rooms.values()) {
      clearInterval(room.saveTimer)
      clearInterval(room.snapshotTimer)
      clearInterval(room.flushTimer)
    }
    // Drain all rooms concurrently — they write to independent rows.
    await Promise.all(
      [...this.rooms.values()].map(async (room) => {
        await this.flushEvents(room.roomId)
        await this.saveRoom(room.roomId)
      }),
    )
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
