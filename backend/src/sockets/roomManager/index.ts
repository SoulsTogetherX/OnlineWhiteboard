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
import { pruneStaleRooms } from "@/db/roomRepository"
import { deleteExpiredSessions } from "@/db/sessionRepository"
import { ensureMembership } from "@/db/roomMembersRepository"
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
import { isValidClientMessage } from "@shared/utils/validateSocketMessage"
import { MAX_CHECKPOINT_NAME_LENGTH } from "@shared/constants/protocol"
import { canDraw, hasEditAuthority } from "@shared/types/identity"

import type { ClientSocket } from "@/types/ClientSocket"
import type {
  ClientSocketMessage,
  RoomAction,
  ServerSocketMessage,
} from "@shared/types/socketProtocol"
import type { DrawInstruction } from "@shared/types/drawProtocol"
import type { Participant } from "@shared/types/identity"
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

// A destructive room action (clear) needs consensus from everyone who has drawn
// recently. "Recently" is this window; an editor who drew longer ago than this
// no longer gets a vote, which stops a long-idle participant blocking the board.
const RECENT_EDITOR_WINDOW_MS = 15 * 60 * 1000 // 15 minutes

// A vote auto-fails if it isn't unanimous within this long — so one AFK voter
// can't leave the board frozen behind a pending vote forever.
const VOTE_TIMEOUT_MS = 30_000
//#endregion

//#region Type Defs
// An open vote on a destructive action. `voters` is everyone whose approval is
// required (the recent editors); `approvals` is who has said yes so far.
type VoteState = {
  voteId: string
  action: RoomAction
  voters: Set<string>
  approvals: Set<string>
  timer: NodeJS.Timeout
  deadline: number
}

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
  // connectionId -> timestamp of that connection's last applied change. Drives
  // who gets a vote on a destructive action.
  recentEditors: Map<string, number>
  // The single in-flight vote, or null. At most one at a time per room.
  activeVote: VoteState | null
}
//#endregion

//#region Room Manager
export default class RoomManager {
  private rooms = new Map<string, RoomState>()
  private heartbeatTimer?: NodeJS.Timeout
  private cleanupTimer?: NodeJS.Timeout

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
      recentEditors: new Map<string, number>(),
      activeVote: null,
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

    if (message.type === "cursor") {
      this.relayCursor(socket, room, message.pos)
      return
    }

    if (message.type === "request_action") {
      this.handleActionRequest(socket, room, message.action)
      return
    }

    if (message.type === "vote") {
      this.handleVote(socket, room, message.voteId, message.approve)
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
    // Viewers are read-only: reject their draws (the client also greys out the
    // tools, but the server is the authority — a crafted client can't bypass it).
    if (!canDraw(socket.identity.role)) {
      this.send(socket, {
        type: "error",
        message: "You have view-only access to this room.",
      })
      return
    }

    // Clients may not clear directly: "clear" is a room action that only the
    // server applies after a vote. Rejecting it here is what makes the vote the
    // ONLY path to wiping a shared board.
    if (message.instruction.type === "clear") {
      this.send(socket, {
        type: "error",
        message: "Clear must go through a vote (request_action).",
      })
      return
    }

    const applied = this.applyInstruction(room, message.instruction)
    // Anyone whose instruction actually landed is now a "recent editor" and gets
    // a say in the next destructive-action vote.
    if (applied) {
      room.recentEditors.set(socket.connectionId, Date.now())
    }
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

  //#region Voting on destructive actions
  // Handles a request to clear the board. If the requester is the only recent
  // editor, it happens immediately; otherwise a vote opens among the recent
  // editors and the requester's own approval is counted.
  private handleActionRequest(
    socket: ClientSocket,
    room: RoomState,
    action: RoomAction,
  ): void {
    // A viewer can't initiate a destructive action any more than they can draw.
    if (!canDraw(socket.identity.role)) {
      this.send(socket, {
        type: "error",
        message: "You have view-only access to this room.",
      })
      return
    }
    if (room.activeVote) {
      this.send(socket, {
        type: "error",
        message: "A vote is already in progress for this room.",
      })
      return
    }

    // Voters = currently-connected recent editors, plus the requester (so they
    // always have a say in their own request).
    const now = Date.now()
    const voters = new Set<string>([socket.connectionId])
    room.clients.forEach((client) => {
      const lastEdit = room.recentEditors.get(client.connectionId)
      if (lastEdit !== undefined && now - lastEdit <= RECENT_EDITOR_WINDOW_MS) {
        voters.add(client.connectionId)
      }
    })

    // Nobody else has drawn recently — no consensus needed.
    if (voters.size <= 1) {
      this.applyRoomAction(room, action)
      return
    }

    const vote: VoteState = {
      voteId: randomUUID(),
      action,
      voters,
      approvals: new Set<string>([socket.connectionId]),
      deadline: now + VOTE_TIMEOUT_MS,
      timer: setTimeout(
        () => this.resolveVote(room, false),
        VOTE_TIMEOUT_MS,
      ),
    }
    room.activeVote = vote

    this.broadcastToVoters(room, vote, {
      type: "vote_started",
      roomId: room.roomId,
      voteId: vote.voteId,
      action,
      initiatorName: socket.identity.name,
      voters: vote.voters.size,
      approvals: vote.approvals.size,
      deadline: vote.deadline,
    })
  }

  private handleVote(
    socket: ClientSocket,
    room: RoomState,
    voteId: string,
    approve: boolean,
  ): void {
    const vote = room.activeVote
    // Ignore stale votes (already resolved / superseded) and non-voters.
    if (!vote || vote.voteId !== voteId) {
      return
    }
    if (!vote.voters.has(socket.connectionId)) {
      return
    }

    // Any single rejection kills the whole vote — a clear must be unanimous.
    if (!approve) {
      this.resolveVote(room, false)
      return
    }

    vote.approvals.add(socket.connectionId)
    this.broadcastToVoters(room, vote, {
      type: "vote_update",
      roomId: room.roomId,
      voteId: vote.voteId,
      voters: vote.voters.size,
      approvals: vote.approvals.size,
    })
    this.checkVoteComplete(room)
  }

  private checkVoteComplete(room: RoomState): void {
    const vote = room.activeVote
    if (!vote) {
      return
    }
    // Unanimous once every voter is in the approvals set.
    for (const voter of vote.voters) {
      if (!vote.approvals.has(voter)) {
        return
      }
    }
    this.resolveVote(room, true)
  }

  private resolveVote(room: RoomState, approved: boolean): void {
    const vote = room.activeVote
    if (!vote) {
      return
    }
    clearTimeout(vote.timer)
    room.activeVote = null

    this.broadcast(room, {
      type: "vote_resolved",
      roomId: room.roomId,
      voteId: vote.voteId,
      approved,
    })

    if (approved) {
      this.applyRoomAction(room, vote.action)
    }
  }

  // Applies a resolved room action. `clear` is applied as a server-generated
  // ClearInstruction so it flows through the same log + broadcast path as any
  // draw (clients apply it via the normal "draw" handler). Recent editors are
  // reset afterwards — the board is now blank, so there's no recent work left to
  // protect and a subsequent clear needn't re-vote.
  private applyRoomAction(room: RoomState, action: RoomAction): void {
    if (action === "clear") {
      this.applyInstruction(room, {
        type: "clear",
        instructionId: -1,
        sessionId: "server",
      })
      room.recentEditors.clear()
    }
  }

  private broadcastToVoters(
    room: RoomState,
    vote: VoteState,
    message: ServerSocketMessage,
  ): void {
    const payload = JSON.stringify(message)
    room.clients.forEach((client) => {
      if (vote.voters.has(client.connectionId)) {
        this.sendRaw(client, payload)
      }
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
      room.recentEditors.set(socket.connectionId, Date.now())

      // Persist immediately so the restore is durable and becomes the new base,
      // then push it to everyone as a snapshot.
      await this.saveRoom(room.roomId)
      this.broadcast(room, this.makeSnapshotMessage(room))
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
    room.recentEditors.delete(socket.connectionId)
    this.broadcastPresence(room)

    // If the leaver was a voter in an open vote, drop them. Their absence may
    // complete the vote (everyone remaining has approved) or, if no voters are
    // left, cancel it.
    const vote = room.activeVote
    if (vote && vote.voters.has(socket.connectionId)) {
      vote.voters.delete(socket.connectionId)
      vote.approvals.delete(socket.connectionId)
      if (vote.voters.size === 0) {
        this.resolveVote(room, false)
      } else {
        this.broadcastToVoters(room, vote, {
          type: "vote_update",
          roomId: room.roomId,
          voteId: vote.voteId,
          voters: vote.voters.size,
          approvals: vote.approvals.size,
        })
        this.checkVoteComplete(room)
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
    if (room.activeVote) {
      clearTimeout(room.activeVote.timer)
    }
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
