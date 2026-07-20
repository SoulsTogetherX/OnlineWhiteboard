//#region Imports
import { randomUUID } from "node:crypto"

import type { RawData, WebSocketServer } from "ws"

import { CANVAS_HEIGHT, CANVAS_WIDTH } from "@shared/constants/canvas"
import { loadCanvas, saveCanvas } from "@/db/canvasRepository"
import {
  appendDrawEvents,
  ensureRoom,
  loadEventsSince,
  type DrawEvent,
} from "@/db/eventRepository"
import {
  getOpenEditing,
  pruneStaleRooms,
  setOpenEditing,
} from "@/db/roomRepository"
import { deleteExpiredSessions } from "@/db/sessionRepository"
import {
  claimOwnership,
  ensureMembership,
  releaseOwnership,
  resolveRole,
  roomHasOwner,
  setRole,
} from "@/db/roomMembersRepository"
import {
  countCheckpoints,
  createCheckpoint,
  deleteCheckpoint,
  listCheckpoints,
  loadCheckpoint,
  maxCheckpointsPerRoom,
  oldestCheckpointRevision,
} from "@/db/checkpointRepository"
import { applyDrawInstructionToCanvas } from "@shared/utils/handleCanvasProtocol"
import { encodeBinaryFrame } from "@shared/utils/binaryFrame"
import { isValidClientMessage } from "@shared/utils/validateSocketMessage"
import { MAX_CHECKPOINT_NAME_LENGTH } from "@shared/constants/protocol"
import {
  INVALID_MESSAGE_COST,
  SocketRateLimiter,
  messageCost,
} from "@/security/socketLimits"
import {
  canDraw,
  canManageRoom,
  canRequestEditor,
  hasEditAuthority,
} from "@shared/types/identity"

import type { ClientSocket } from "@/types/ClientSocket"
import type {
  ClientSocketMessage,
  RoomAction,
  ServerSocketMessage,
} from "@shared/types/socketProtocol"
import type { DrawInstruction } from "@shared/types/drawProtocol"
import type { Participant, RoomRole } from "@shared/types/identity"
import type { Vec } from "@shared/types/primitive"
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

// A room whose last save is older than this and that nobody is in gets deleted
// (with its snapshots and events, via ON DELETE CASCADE). This is the only
// unbounded table left — a row per room ever visited — so it needs an explicit
// retention policy the way the event log and snapshots don't.
const ROOM_RETENTION_MS = 90 * 24 * 60 * 60 * 1000 // 90 days

// How often the cleanup sweep runs. Daily is plenty — retention is measured in
// months, so the exact cadence doesn't matter, only that it happens.
const CLEANUP_INTERVAL_MS = 24 * 60 * 60 * 1000 // 24 hours

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
  // Whether people without edit authority may draw here. Mirrored in memory
  // from rooms.open_editing so the hot path — every single draw message —
  // answers the permission question without a query.
  openEditing: boolean
  // Whether the room currently has an owner. Also mirrored, for the same reason:
  // it gates the "claim ownership" affordance every client asks about on join.
  hasOwner: boolean
  // Pending editor requests, keyed by account id. Deliberately IN MEMORY and not
  // persisted: a request is a live "please let me in now" from someone present,
  // and one left over from a visitor who closed their tab days ago is noise the
  // owner would have to dismiss. Cleared when the requester disconnects.
  editorRequests: Map<string, { name: string; connectionId: string }>
}
//#endregion

//#region Room Manager
export default class RoomManager {
  private rooms = new Map<string, RoomState>()

  // Rooms whose load is currently in flight, so concurrent joiners share ONE
  // load instead of each building their own RoomState. Entries live only for the
  // duration of the load; once it resolves the room is in `rooms` and this is
  // cleared. See getOrCreateRoom for why this is load-bearing.
  private roomLoads = new Map<string, Promise<RoomState>>()
  private heartbeatTimer?: NodeJS.Timeout
  private cleanupTimer?: NodeJS.Timeout
  // Per-socket flood control. Keyed by the socket object, so state disappears
  // with the connection.
  private rateLimiter = new SocketRateLimiter()

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

  // Starts the periodic cleanup sweep (stale rooms + expired sessions). Kept
  // separate from start() and called by the server only AFTER migrations have
  // run, because — unlike the heartbeat — this touches the database, and start()
  // runs before the schema exists (it's wired up during configureWebSockets,
  // ahead of runMigrations). Runs once now to clear anything accumulated while
  // the server was down, then daily.
  startCleanup(): void {
    void this.runCleanup()
    this.cleanupTimer = setInterval(
      () => void this.runCleanup(),
      CLEANUP_INTERVAL_MS,
    )
  }

  private async runCleanup(): Promise<void> {
    // Both sweeps bound a table that would otherwise grow forever — abandoned
    // rooms and logged-out/expired sessions. Independent, so a failure in one
    // doesn't skip the other.
    try {
      const cutoff = new Date(Date.now() - ROOM_RETENTION_MS)
      // Never delete a room someone is currently in — see pruneStaleRooms.
      const deleted = await pruneStaleRooms(cutoff, [...this.rooms.keys()])
      if (deleted > 0) {
        console.log(
          `cleanup: removed ${deleted} room(s) untouched since ` +
            cutoff.toISOString(),
        )
      }
    } catch (error) {
      // Not fatal — the rows are harmless and the next sweep retries.
      console.error("Stale-room cleanup failed:", error)
    }

    try {
      const removed = await deleteExpiredSessions()
      if (removed > 0) {
        console.log(`cleanup: removed ${removed} expired session(s)`)
      }
    } catch (error) {
      console.error("Expired-session cleanup failed:", error)
    }
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

    // Resolve this connection's role now that the room exists (its FK target is
    // in place). A registered user gets/creates a membership — owner on first
    // visit to a fresh room, editor otherwise — which overwrites the provisional
    // role from resolveConnectionIdentity. Guests stay "guest". A failure here
    // leaves the provisional role rather than blocking the join.
    if (socket.userId) {
      try {
        socket.identity.role = await ensureMembership(roomId, socket.userId)
      } catch (error) {
        console.error(`Failed to resolve role for room "${roomId}":`, error)
      }
    }

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
      openEditing: room.openEditing,
      hasOwner: room.hasOwner,
      self: socket.identity,
      participants: this.roster(room),
    })
    this.sendSnapshot(socket, room)
    // The room's saved versions, so the client can populate its checkpoint panel
    // and offer playback immediately.
    void this.sendCheckpoints(socket, room)
    this.broadcastPresence(room)

    // Drain in arrival order, then switch to handling inline. Draining before
    // flipping the flag would let a message that arrives mid-drain jump ahead
    // of the queue and apply out of order.
    isReady = true
    for (const raw of pending) {
      await this.handleMessage(socket, raw)
    }
  }

  // Returns the room, loading it if it is not cached — and guaranteeing that
  // concurrent callers for the same roomId all get the SAME RoomState.
  //
  // The guarantee is the whole point. `loadRoom` awaits five database round
  // trips before it can publish into `rooms`, and this used to be a bare
  // check-then-load: every caller that arrived during that window missed the
  // cache, built its own RoomState, and the last one to finish overwrote the
  // others in the Map. The clients attached to the losers were then in rooms
  // nobody could reach — three simultaneous joins measured presence [1, 1, 1]
  // with strokes reaching nobody, instead of [3, 3, 3]. Worse, an orphaned room
  // keeps its save/snapshot/flush timers running forever (disposeIfEmpty only
  // ever sees the Map) and goes on writing snapshots for the same roomId under
  // a competing revision counter.
  //
  // This is not a rare race: after any restart or deploy every client reconnects
  // at once into cold rooms, which is exactly the trigger.
  private async getOrCreateRoom(roomId: string): Promise<RoomState> {
    const cached = this.rooms.get(roomId)
    if (cached) {
      return cached
    }

    // Somebody else is already loading this room — await THEIR load rather than
    // starting a second one.
    const inFlight = this.roomLoads.get(roomId)
    if (inFlight) {
      return inFlight
    }

    const load = this.loadRoom(roomId)
    this.roomLoads.set(roomId, load)
    try {
      return await load
    } finally {
      // Cleared whether the load succeeded or threw. `loadRoom` publishes into
      // `rooms` before it resolves, so there is no window where a later caller
      // finds neither the cache nor an in-flight load and starts a third one.
      // On failure, clearing lets the next joiner retry instead of inheriting a
      // permanently rejected promise.
      this.roomLoads.delete(roomId)
    }
  }

  private async loadRoom(roomId: string): Promise<RoomState> {
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
      //
      // "replay", not "decide": the log holds what each patch ACTUALLY applied
      // when it was first decided. Re-deciding it against a rebuilt buffer would
      // let recovery reach a different canvas than the one that was live.
      applyDrawInstructionToCanvas(stored.pixels, event.instruction, "replay")
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

    // Permission state is read ONCE here and mirrored in memory for the room's
    // lifetime. Every draw message asks "may this connection draw?", so querying
    // it per message would put a database round trip on the hottest path in the
    // application. Both are kept in step by the handlers that change them.
    const openEditing = await getOpenEditing(roomId)
    const hasOwner = await roomHasOwner(roomId)

    const room: RoomState = {
      roomId,
      clients: new Set<ClientSocket>(),
      pixels: stored.pixels,
      revision,
      isDirty: false,
      eventBuffer: [],
      isFlushing: false,
      openEditing,
      hasOwner,
      editorRequests: new Map<string, { name: string; connectionId: string }>(),
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

    // Charge for the message BEFORE acting on it, and charge for invalid ones
    // too. Validation bounds what a single message can do; only this bounds how
    // many. Metering invalid messages matters just as much: each one sends an
    // error back, so unmetered junk would be an amplification vector.
    const decision = this.rateLimiter.consume(
      socket,
      message ? messageCost(message) : INVALID_MESSAGE_COST,
    )
    if (decision === "close") {
      // Only reached after sustained abuse — a brief overshoot just drops.
      socket.close(1008, "Rate limit exceeded")
      return
    }
    if (decision === "drop") {
      return
    }

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

    if (message.type === "cursor") {
      this.relayCursor(socket, room, message.pos)
      return
    }

    if (message.type === "room_action") {
      this.handleRoomAction(socket, room, message.action)
      return
    }

    if (message.type === "claim_ownership") {
      void this.handleClaimOwnership(socket, room)
      return
    }
    if (message.type === "release_ownership") {
      void this.handleReleaseOwnership(socket, room)
      return
    }
    if (message.type === "set_open_editing") {
      void this.handleSetOpenEditing(socket, room, message.enabled)
      return
    }
    if (message.type === "request_editor") {
      this.handleRequestEditor(socket, room)
      return
    }
    if (message.type === "respond_editor") {
      void this.handleRespondEditor(
        socket,
        room,
        message.userId,
        message.approve,
      )
      return
    }
    if (message.type === "set_member_role") {
      void this.handleSetMemberRole(socket, room, message.userId, message.role)
      return
    }

    if (message.type === "create_checkpoint") {
      void this.handleCreateCheckpoint(socket, room, message.name)
      return
    }
    if (message.type === "restore_checkpoint") {
      void this.handleRestoreCheckpoint(socket, room, message.checkpointId)
      return
    }
    if (message.type === "delete_checkpoint") {
      void this.handleDeleteCheckpoint(socket, room, message.checkpointId)
      return
    }
    if (message.type === "request_playback") {
      void this.handlePlayback(socket, room, message.fromCheckpointId)
      return
    }

    // Only "draw" remains — TypeScript has narrowed the union accordingly.
    //
    // The client greys out its tools using this same shared rule, but that is
    // cosmetic: this check is the one that matters, because a crafted client
    // simply would not run the cosmetic one. Note it reads the room's live
    // openEditing, so revoking open editing takes effect on the very next
    // message — no reconnect, no cache to invalidate.
    if (!canDraw(socket.identity.role, room.openEditing)) {
      this.send(socket, {
        type: "error",
        message: "You do not have permission to draw in this room.",
      })
      return
    }

    // Clients may not clear directly. Clear is a room action the server applies
    // on the owner's behalf; rejecting it here is what makes owner-only the ONLY
    // path to wiping a shared board, rather than something the UI merely hides.
    if (message.instruction.type === "clear") {
      this.send(socket, {
        type: "error",
        message: "Clear is a room action (room_action), not a draw instruction.",
      })
      return
    }

    this.applyInstruction(room, message.instruction)
  }

  // Relays a cursor position to everyone else in the room. Pure pass-through:
  // no validation beyond shape (a bad position just renders a dot in the wrong
  // place, it can't corrupt anything), no canvas mutation, no persistence. Not
  // echoed to the sender — a client doesn't need its own cursor sent back.
  private relayCursor(
    socket: ClientSocket,
    room: RoomState,
    pos: Vec | null,
  ): void {
    const message: ServerSocketMessage = {
      type: "cursor",
      roomId: room.roomId,
      connectionId: socket.connectionId,
      pos,
    }
    const payload = JSON.stringify(message)
    room.clients.forEach((client) => {
      if (client !== socket) {
        this.sendRaw(client, payload)
      }
    })
  }

  // Parses AND validates. This used to end in `JSON.parse(text) as
  // ClientSocketMessage` — a cast that checks nothing at runtime, leaving every
  // field outside the instruction payload unverified all the way to the
  // handlers. `isValidClientMessage` closes that: an unrecognised type, a
  // missing roomId or an over-long id is dropped here and never reaches a
  // handler.
  private parseMessage(raw: RawData): ClientSocketMessage | null {
    try {
      const text = Buffer.isBuffer(raw) ? raw.toString("utf8") : raw.toString()
      const parsed: unknown = JSON.parse(text)
      return isValidClientMessage(parsed) ? parsed : null
    } catch {
      return null
    }
  }

  // Returns the instruction that actually applied (so the caller can mark the
  // sender a recent editor), or null if it was rejected / a no-op.
  private applyInstruction(
    room: RoomState,
    instruction: DrawInstruction,
  ): DrawInstruction | null {
    const applied = applyDrawInstructionToCanvas(room.pixels, instruction)
    if (!applied) {
      return null
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
    return applied
  }

  //#region Ownership, permissions and editor requests
  // Applies a destructive room action immediately. OWNER ONLY.
  // Why ownership rather than group consensus gates this is recorded in
  // CLAUDE.md's decision record.
  private handleRoomAction(
    socket: ClientSocket,
    room: RoomState,
    action: RoomAction,
  ): void {
    if (!canManageRoom(socket.identity.role)) {
      this.send(socket, {
        type: "error",
        message: "Only the room owner can do that.",
      })
      return
    }

    if (action === "clear") {
      // Applied as a server-generated instruction so it flows through the same
      // log, broadcast and replay path as any other change — recovery treats it
      // identically and no client needs a special case.
      this.applyInstruction(room, {
        type: "clear",
        instructionId: -1,
        sessionId: "server",
      })
    }
  }

  // Takes ownership of a room that has none. Signed-in visitors only, and never
  // automatic: opening a link must not silently hand you powers you did not ask
  // for and were never told about.
  private async handleClaimOwnership(
    socket: ClientSocket,
    room: RoomState,
  ): Promise<void> {
    if (!socket.userId) {
      this.send(socket, {
        type: "error",
        message: "Sign in to take ownership of a room.",
      })
      return
    }

    try {
      const role = await claimOwnership(room.roomId, socket.userId)
      if (!role) {
        // Lost the race, or it was already owned. Either way the answer is the
        // same and the client's stale view gets corrected below.
        room.hasOwner = true
        this.broadcastRoomSettings(room)
        this.send(socket, {
          type: "error",
          message: "This room already has an owner.",
        })
        return
      }

      room.hasOwner = true
      await this.refreshRoles(room)
      this.broadcastRoomSettings(room)
      // A brand-new owner needs to see anything already waiting for them.
      this.sendEditorRequests(socket, room)
    } catch (error) {
      console.error(`Failed to claim ownership of ${room.roomId}:`, error)
      this.send(socket, {
        type: "error",
        message: "Could not take ownership.",
      })
    }
  }

  // Gives up ownership, leaving the room unowned so somebody else can take it.
  private async handleReleaseOwnership(
    socket: ClientSocket,
    room: RoomState,
  ): Promise<void> {
    if (!socket.userId || !canManageRoom(socket.identity.role)) {
      this.send(socket, {
        type: "error",
        message: "Only the room owner can release ownership.",
      })
      return
    }

    try {
      const released = await releaseOwnership(room.roomId, socket.userId)
      if (!released) {
        // Lost a race with a transfer, or never actually held it. Correct the
        // client's view rather than leaving it showing a control it cannot use.
        await this.refreshRoles(room)
        this.broadcastRoomSettings(room)
        return
      }

      // Any pending editor requests die with the ownership: there is now nobody
      // to answer them, and they would sit unanswerable until someone claimed
      // the room.
      const hadRequests = room.editorRequests.size > 0
      room.editorRequests.clear()

      await this.refreshRoles(room)
      this.broadcastRoomSettings(room)
      if (hadRequests) {
        this.broadcastEditorRequests(room)
      }
    } catch (error) {
      console.error(`Failed to release ownership of ${room.roomId}:`, error)
      this.send(socket, {
        type: "error",
        message: "Could not release ownership.",
      })
    }
  }

  // Turns open editing on or off. OWNER ONLY.
  private async handleSetOpenEditing(
    socket: ClientSocket,
    room: RoomState,
    enabled: boolean,
  ): Promise<void> {
    if (!canManageRoom(socket.identity.role)) {
      this.send(socket, {
        type: "error",
        message: "Only the room owner can change who may draw.",
      })
      return
    }

    try {
      await setOpenEditing(room.roomId, enabled)
      // Mirror in memory only AFTER the write succeeds, so a failed write can
      // never leave the server enforcing a rule it did not persist.
      room.openEditing = enabled
      this.broadcastRoomSettings(room)
    } catch (error) {
      console.error(`Failed to set open editing on ${room.roomId}:`, error)
      this.send(socket, {
        type: "error",
        message: "Could not change that setting.",
      })
    }
  }

  // A signed-in viewer asking the owner for edit access.
  private handleRequestEditor(socket: ClientSocket, room: RoomState): void {
    if (!socket.userId) {
      this.send(socket, {
        type: "error",
        message: "Sign in to request edit access.",
      })
      return
    }
    if (!canRequestEditor(socket.identity.role)) {
      this.send(socket, {
        type: "error",
        message: "You already have edit access.",
      })
      return
    }
    if (!room.hasOwner) {
      this.send(socket, {
        type: "error",
        message: "This room has no owner to ask.",
      })
      return
    }

    // Keyed by account, so spamming the button or opening five tabs still
    // produces exactly one entry for the owner to act on.
    room.editorRequests.set(socket.userId, {
      name: socket.identity.name,
      connectionId: socket.connectionId,
    })
    this.broadcastEditorRequests(room)
  }

  // The owner's answer. OWNER ONLY.
  private async handleRespondEditor(
    socket: ClientSocket,
    room: RoomState,
    userId: string,
    approve: boolean,
  ): Promise<void> {
    if (!canManageRoom(socket.identity.role)) {
      this.send(socket, {
        type: "error",
        message: "Only the room owner can answer requests.",
      })
      return
    }

    // Removed whether approved or denied — either way it has been dealt with,
    // and leaving a denied request in the list would make it un-dismissable.
    const pending = room.editorRequests.delete(userId)
    if (!pending) {
      return
    }

    try {
      if (approve) {
        await setRole(room.roomId, userId, "editor")
        await this.refreshRoles(room)
      }
      this.broadcastEditorRequests(room)
    } catch (error) {
      console.error(`Failed to answer editor request in ${room.roomId}:`, error)
      this.send(socket, {
        type: "error",
        message: "Could not update that member.",
      })
    }
  }

  // Sets a member's role directly. OWNER ONLY.
  private async handleSetMemberRole(
    socket: ClientSocket,
    room: RoomState,
    userId: string,
    role: RoomRole,
  ): Promise<void> {
    if (!canManageRoom(socket.identity.role)) {
      this.send(socket, {
        type: "error",
        message: "Only the room owner can change roles.",
      })
      return
    }

    try {
      // setRole refuses to demote the only owner (that would orphan the room)
      // and treats a promotion to owner as an atomic TRANSFER.
      const changed = await setRole(room.roomId, userId, role)
      if (!changed) {
        this.send(socket, {
          type: "error",
          message:
            "Could not change that role. Transfer ownership instead of demoting the owner.",
        })
        return
      }
      // A transfer changes TWO people's roles, so re-resolve everyone rather
      // than assuming only the target moved.
      await this.refreshRoles(room)
      this.broadcastRoomSettings(room)
    } catch (error) {
      console.error(`Failed to set role in ${room.roomId}:`, error)
      this.send(socket, { type: "error", message: "Could not change that role." })
    }
  }

  // Re-reads every signed-in connection's role from the database and pushes the
  // change to anyone whose role actually moved.
  //
  // Re-resolving EVERYONE rather than patching the one account that was targeted
  // is deliberate: an ownership transfer demotes the previous owner as a side
  // effect, and a client whose powers silently vanished without being told would
  // keep showing controls the server now rejects.
  private async refreshRoles(room: RoomState): Promise<void> {
    let rosterChanged = false

    for (const client of room.clients) {
      if (!client.userId) {
        continue
      }
      try {
        const role = (await resolveRole(room.roomId, client.userId)) ?? "viewer"
        if (client.identity.role === role) {
          continue
        }
        client.identity.role = role
        rosterChanged = true
        this.send(client, {
          type: "role_changed",
          roomId: room.roomId,
          self: client.identity,
        })
      } catch (error) {
        console.error(`Failed to refresh a role in ${room.roomId}:`, error)
      }
    }

    room.hasOwner = await roomHasOwner(room.roomId)
    if (rosterChanged) {
      this.broadcastPresence(room)
    }
  }

  // Editor requests go ONLY to owners. The list names people asking for
  // promotion; nobody else has a use for it or a right to it.
  private broadcastEditorRequests(room: RoomState): void {
    room.clients.forEach((client) => {
      if (canManageRoom(client.identity.role)) {
        this.sendEditorRequests(client, room)
      }
    })
  }

  private sendEditorRequests(socket: ClientSocket, room: RoomState): void {
    this.send(socket, {
      type: "editor_requests",
      roomId: room.roomId,
      requests: [...room.editorRequests.entries()].map(([userId, info]) => ({
        userId,
        name: info.name,
      })),
    })
  }

  private broadcastRoomSettings(room: RoomState): void {
    this.broadcast(room, {
      type: "room_settings",
      roomId: room.roomId,
      openEditing: room.openEditing,
      hasOwner: room.hasOwner,
    })
  }
  //#endregion

  //#region Checkpoints & playback
  // Saves the current canvas as a named, durable version. Editors only. The
  // pixels + revision are captured SYNCHRONOUSLY before any await, so a stroke
  // arriving mid-save can't make the stored bytes and revision disagree. Pending
  // events are flushed first so the log is consistent up to this point.
  private async handleCreateCheckpoint(
    socket: ClientSocket,
    room: RoomState,
    name: string,
  ): Promise<void> {
    if (!hasEditAuthority(socket.identity.role)) {
      this.send(socket, {
        type: "error",
        message: "Only editors can save checkpoints.",
      })
      return
    }
    const trimmed =
      typeof name === "string"
        ? name.trim().slice(0, MAX_CHECKPOINT_NAME_LENGTH)
        : ""
    if (trimmed.length === 0) {
      this.send(socket, { type: "error", message: "Checkpoint needs a name." })
      return
    }

    const pixels = new Uint8ClampedArray(room.pixels)
    const revision = room.revision

    try {
      if ((await countCheckpoints(room.roomId)) >= maxCheckpointsPerRoom()) {
        this.send(socket, {
          type: "error",
          message: `A room can keep at most ${maxCheckpointsPerRoom()} checkpoints — delete one first.`,
        })
        return
      }
      await this.flushEvents(room.roomId)
      await createCheckpoint({
        roomId: room.roomId,
        name: trimmed,
        revision,
        pixels,
        createdBy: socket.userId,
      })
      await this.broadcastCheckpoints(room)
    } catch (error) {
      console.error(`Failed to create checkpoint in ${room.roomId}:`, error)
      this.send(socket, {
        type: "error",
        message: "Could not save checkpoint.",
      })
    }
  }

  // Jumps the live canvas back to a saved version. Editors only. The restore is
  // applied as a fresh authoritative state: set the pixels, advance the revision,
  // persist a snapshot, and broadcast that snapshot so every client replaces
  // their canvas. It is NOT logged as an instruction — the new snapshot IS the
  // state, and recovery uses the latest snapshot, so this stays consistent.
  private async handleRestoreCheckpoint(
    socket: ClientSocket,
    room: RoomState,
    checkpointId: string,
  ): Promise<void> {
    if (!hasEditAuthority(socket.identity.role)) {
      this.send(socket, {
        type: "error",
        message: "Only editors can restore checkpoints.",
      })
      return
    }

    try {
      const checkpoint = await loadCheckpoint(room.roomId, checkpointId)
      if (!checkpoint) {
        this.send(socket, {
          type: "error",
          message: "That checkpoint no longer exists.",
        })
        return
      }

      room.pixels.set(checkpoint.pixels)
      room.revision += 1
      room.isDirty = true

      // Persist immediately so the restore is durable and becomes the new base,
      // then push it to everyone as a snapshot.
      await this.saveRoom(room.roomId)
      this.broadcastSnapshot(room)
    } catch (error) {
      console.error(`Failed to restore checkpoint in ${room.roomId}:`, error)
      this.send(socket, { type: "error", message: "Could not restore." })
    }
  }

  private async handleDeleteCheckpoint(
    socket: ClientSocket,
    room: RoomState,
    checkpointId: string,
  ): Promise<void> {
    if (!hasEditAuthority(socket.identity.role)) {
      this.send(socket, {
        type: "error",
        message: "Only editors can delete checkpoints.",
      })
      return
    }
    try {
      await deleteCheckpoint(room.roomId, checkpointId)
      await this.broadcastCheckpoints(room)
    } catch (error) {
      console.error(`Failed to delete checkpoint in ${room.roomId}:`, error)
    }
  }

  // Sends the requester the data to animate history: a base canvas plus the
  // events after it. Read-only, so anyone in the room (including viewers) may
  // watch. From a checkpoint, the base is that checkpoint; otherwise the latest
  // rolling snapshot (i.e. "replay what happened since the last save").
  private async handlePlayback(
    socket: ClientSocket,
    room: RoomState,
    fromCheckpointId: string | undefined,
  ): Promise<void> {
    try {
      // Flush so the log the client replays is up to date.
      await this.flushEvents(room.roomId)

      let base: Uint8ClampedArray
      let baseRevision: number
      if (fromCheckpointId) {
        const checkpoint = await loadCheckpoint(room.roomId, fromCheckpointId)
        if (!checkpoint) {
          this.send(socket, {
            type: "error",
            message: "That checkpoint no longer exists.",
          })
          return
        }
        base = checkpoint.pixels
        baseRevision = checkpoint.revision
      } else {
        const stored = await loadCanvas(room.roomId)
        base = stored.pixels
        baseRevision = stored.revision
      }

      const events = await loadEventsSince(room.roomId, baseRevision)
      this.send(socket, {
        type: "playback",
        roomId: room.roomId,
        base: Buffer.from(base).toString("base64"),
        baseRevision,
        steps: events.map((event) => ({
          revision: event.revision,
          instruction: event.instruction,
        })),
      })
    } catch (error) {
      console.error(`Failed to build playback for ${room.roomId}:`, error)
      this.send(socket, { type: "error", message: "Could not load history." })
    }
  }

  private async broadcastCheckpoints(room: RoomState): Promise<void> {
    const checkpoints = await this.checkpointList(room.roomId)
    this.broadcast(room, {
      type: "checkpoints",
      roomId: room.roomId,
      checkpoints,
    })
  }

  private async sendCheckpoints(
    socket: ClientSocket,
    room: RoomState,
  ): Promise<void> {
    this.send(socket, {
      type: "checkpoints",
      roomId: room.roomId,
      checkpoints: await this.checkpointList(room.roomId),
    })
  }

  // Metadata list with createdAt serialised to an ISO string for the wire.
  private async checkpointList(roomId: string) {
    const rows = await listCheckpoints(roomId)
    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      revision: row.revision,
      createdAt: row.createdAt.toISOString(),
    }))
  }
  //#endregion

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

    // Drop any editor request this connection was the source of. A request is a
    // live "let me in now" from someone present; leaving one behind after they
    // close the tab gives the owner a prompt about a person who is not there.
    //
    // Matched on connectionId, not account: the same account in another tab is a
    // different connection and its request should survive this one closing.
    if (socket.userId) {
      const pending = room.editorRequests.get(socket.userId)
      if (pending && pending.connectionId === socket.connectionId) {
        room.editorRequests.delete(socket.userId)
        this.broadcastEditorRequests(room)
      }
    }

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
    clearInterval(this.cleanupTimer)
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
      // Keep events newer than the oldest checkpoint so history stays replayable
      // from it; with no checkpoints this is null and compaction is fully bounded.
      const retainAfter = await oldestCheckpointRevision(room.roomId)
      await saveCanvas(room.roomId, room.pixels, room.revision, retainAfter)
      room.isDirty = false
    } catch (error) {
      console.error(`Failed to save room ${room.roomId}:`, error)
    }
  }

  // The room's current roster — one entry per connected socket, in join order.
  private roster(room: RoomState): Participant[] {
    return [...room.clients].map((client) => client.identity)
  }

  private broadcastPresence(room: RoomState): void {
    this.broadcast(room, {
      type: "presence",
      roomId: room.roomId,
      participants: this.roster(room),
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

  // Snapshots go out as a BINARY frame: a small JSON header plus the raw RGBA
  // bytes. The pixels are captured with Buffer.from, which COPIES — room.pixels
  // keeps being mutated by live draws while this frame is queued, and sending a
  // view over it would put whatever the canvas looked like at flush time on the
  // wire instead of at capture time, disagreeing with the `revision` in the
  // header.
  private sendSnapshot(socket: ClientSocket, room: RoomState): void {
    this.sendBinary(socket, this.makeSnapshotFrame(room))
  }

  // Encoded ONCE and sent to every client, mirroring how broadcast() stringifies
  // once. Re-encoding per client would copy the whole canvas per recipient.
  private broadcastSnapshot(room: RoomState): void {
    const frame = this.makeSnapshotFrame(room)
    room.clients.forEach((client) => this.sendBinary(client, frame))
  }

  private makeSnapshotFrame(room: RoomState): Uint8Array {
    const header: ServerSocketMessage = {
      type: "canvas_snapshot",
      roomId: room.roomId,
      revision: room.revision,
      width: CANVAS_WIDTH,
      height: CANVAS_HEIGHT,
    }
    return encodeBinaryFrame(header, Buffer.from(room.pixels))
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

  // `binary: true` is explicit rather than inferred. `ws` does pick binary for a
  // Uint8Array on its own, but the distinction decides whether the client's
  // `event.data` arrives as an ArrayBuffer or a string, and that is too load
  // bearing to leave to a default.
  private sendBinary(socket: ClientSocket, frame: Uint8Array): void {
    if (socket.readyState !== socket.OPEN) {
      return
    }
    socket.send(frame, { binary: true })
  }
}
//#endregion
