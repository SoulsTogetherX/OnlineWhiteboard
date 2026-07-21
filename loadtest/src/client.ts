//#region Imports
import WebSocket from "ws"

import { DEFAULT_CANVAS_DIMS } from "@shared/constants/canvas"
import { decodeBinaryFrame } from "@shared/utils/binaryFrame"

import type {
  ClientSocketMessage,
  ServerSocketMessage,
} from "@shared/types/socketProtocol"
import type { DrawInstruction } from "@shared/types/drawProtocol"
//#endregion

//#region Types
// Shared across every client in a single test run (same Node process), keyed
// by a JSON-serialized instruction. Because it's one process with one clock,
// we can measure true fan-out latency (sender -> every recipient) with no
// clock-sync issues: whoever sends an instruction records `sentAt` here, and
// every client (including the sender itself, since the server echoes your
// own draw back to you) computes `now - sentAt` when that same instruction
// arrives as a "draw" broadcast.
export type PendingMap = Map<string, number>

export type ClientMetrics = {
  connectMs: number | null
  readyMs: number | null
  connected: boolean
  error: string | null
  pingLatencies: number[]
  fanoutLatencies: number[]
  messagesReceived: number
  bytesReceived: number
  snapshotBytesReceived: number
}

export type ClientOptions = {
  id: number
  url: string
  roomId: string
  isDrawer: boolean
  drawIntervalMs: number
  pingIntervalMs: number
  connectTimeoutMs: number
}
//#endregion

//#region Helpers
// Every simulated client gets a stable session id, mirroring how a real client
// gets one from useSessionID.
const SESSION_ID = `loadtest-${process.pid}`
let nextInstructionId = 0

function randomInstruction(): DrawInstruction {
  const prevPos: [number, number] = [
    Math.floor(Math.random() * DEFAULT_CANVAS_DIMS.width),
    Math.floor(Math.random() * DEFAULT_CANVAS_DIMS.height),
  ]
  const nextPos: [number, number] = [
    Math.floor(Math.random() * DEFAULT_CANVAS_DIMS.width),
    Math.floor(Math.random() * DEFAULT_CANVAS_DIMS.height),
  ]
  return {
    type: "pencil",
    prevPos,
    nextPos,
    color: {
      r: Math.floor(Math.random() * 256),
      g: Math.floor(Math.random() * 256),
      b: Math.floor(Math.random() * 256),
      a: 255,
    },
    // instructionId and sessionId are required by BaseInstruction. They were
    // missing: the harness runs under tsx, which strips types WITHOUT checking
    // them, so it kept working by accident while `tsc --noEmit` failed. The
    // shared types had been telling us the harness was out of date and nothing
    // in the pipeline was listening — hence the `typecheck` script now.
    instructionId: nextInstructionId++,
    sessionId: SESSION_ID,
  }
}

function instructionKey(instruction: DrawInstruction): string {
  return JSON.stringify(instruction)
}
//#endregion

//#region Simulated Client
export class SimulatedClient {
  readonly metrics: ClientMetrics = {
    connectMs: null,
    readyMs: null,
    connected: false,
    error: null,
    pingLatencies: [],
    fanoutLatencies: [],
    messagesReceived: 0,
    bytesReceived: 0,
    snapshotBytesReceived: 0,
  }

  private ws: WebSocket | null = null
  private pingTimer: NodeJS.Timeout | null = null
  private drawTimer: NodeJS.Timeout | null = null

  constructor(
    private readonly opts: ClientOptions,
    private readonly pending: PendingMap,
  ) {}

  connect(): Promise<void> {
    const startedAt = Date.now()

    return new Promise((resolve, reject) => {
      let settled = false

      const timeout = setTimeout(() => {
        if (settled) return
        settled = true
        this.metrics.error = "connect timeout"
        this.ws?.terminate()
        reject(new Error("connect timeout"))
      }, this.opts.connectTimeoutMs)

      const wsUrl = `${this.opts.url}?roomId=${encodeURIComponent(this.opts.roomId)}`
      const ws = new WebSocket(wsUrl)
      this.ws = ws

      ws.on("open", () => {
        this.metrics.connectMs = Date.now() - startedAt
      })

      ws.on("message", (raw) => {
        this.metrics.messagesReceived += 1
        const buf = raw as Buffer
        this.metrics.bytesReceived += buf.length

        // Snapshots now arrive as binary frames (a small JSON header plus raw
        // RGBA); everything else is still text. The header is all this harness
        // needs — it only ever counts snapshot bytes, never applies them — but
        // the payload length is passed along so the metric stays honest.
        let message: ServerSocketMessage
        let payloadBytes = 0
        const frame = decodeBinaryFrame(buf)
        if (frame !== null) {
          message = frame.header as ServerSocketMessage
          payloadBytes = frame.payload.length
        } else {
          try {
            message = JSON.parse(buf.toString("utf8"))
          } catch {
            return
          }
        }

        this.handleMessage(message, payloadBytes)

        if (message.type === "ready" && !settled) {
          settled = true
          clearTimeout(timeout)
          this.metrics.readyMs = Date.now() - startedAt
          this.metrics.connected = true
          resolve()
        }
      })

      ws.on("error", (err) => {
        this.metrics.error = err.message
        if (!settled) {
          settled = true
          clearTimeout(timeout)
          reject(err)
        }
      })

      ws.on("close", () => {
        this.metrics.connected = false
      })
    })
  }

  private handleMessage(
    message: ServerSocketMessage,
    payloadBytes: number,
  ): void {
    const now = Date.now()

    switch (message.type) {
      case "pong":
        this.metrics.pingLatencies.push(now - message.sentAt)
        break
      case "canvas_snapshot":
        // Now the payload's REAL byte count. This used to add the base64 string
        // length, which overstated the true cost by ~4/3 — so expect this
        // number to drop by about a quarter versus older runs for the same
        // traffic, on top of the genuine bandwidth saving.
        this.metrics.snapshotBytesReceived += payloadBytes
        break
      case "draw": {
        const key = instructionKey(message.instruction)
        const sentAt = this.pending.get(key)
        if (sentAt !== undefined) {
          this.metrics.fanoutLatencies.push(now - sentAt)
        }
        break
      }
      default:
        break
    }
  }

  start(): void {
    this.pingTimer = setInterval(
      () => this.sendPing(),
      this.opts.pingIntervalMs,
    )
    if (this.opts.isDrawer) {
      this.drawTimer = setInterval(
        () => this.sendDraw(),
        this.opts.drawIntervalMs,
      )
    }
  }

  private sendPing(): void {
    this.send({ type: "ping", sentAt: Date.now() })
  }

  private sendDraw(): void {
    const instruction = randomInstruction()
    this.pending.set(instructionKey(instruction), Date.now())
    this.send({ type: "draw", roomId: this.opts.roomId, instruction })
  }

  private send(message: ClientSocketMessage): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      return
    }
    this.ws.send(JSON.stringify(message))
  }

  stop(): void {
    if (this.pingTimer) clearInterval(this.pingTimer)
    if (this.drawTimer) clearInterval(this.drawTimer)
    this.ws?.close()
  }
}
//#endregion
