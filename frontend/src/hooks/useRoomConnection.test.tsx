// Covers the one decision useRoomConnection makes about a "draw" broadcast that
// is not "apply it": whether this client is the one that SENT it.
//
// The server broadcasts to everyone including the sender, so every client applies
// its own instructions twice — optimistically at gesture time, then again on the
// echo. That is invisible for the tools that SET pixels and wrong for the one
// that TRANSFORMS them: replaying your own blur blurs an already-blurred canvas,
// which leaves you softer than the rest of the room and makes your undo record
// describe pixels the canvas no longer holds, so undo restores nothing.

import { act, renderHook } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"

import useRoomConnection from "./useRoomConnection"

import { applyDrawInstructionToCanvas } from "@shared/utils/handleCanvasProtocol"

import type { WebSocketOptions } from "./useWebSocket"
import type { BlurInstruction, DrawInstruction } from "@shared/types/drawProtocol"
import type { Participant } from "@shared/types/identity"

//#region Socket mock
// Captures the options useRoomConnection builds so a test can drive its
// onMessage directly, and records everything it tries to send.
const socket = {
  onMessage: undefined as WebSocketOptions["onMessage"],
  send: vi.fn(() => true),
}

vi.mock("./useWebSocket", () => ({
  default: (_url: unknown, _roomId: string, options?: WebSocketOptions) => {
    socket.onMessage = options?.onMessage
    return {
      status: { current: "OPENED" },
      data: { current: undefined },
      send: socket.send,
      open: () => {},
      close: () => {},
      ws: { current: null },
    }
  },
}))

// The canvas work in useRoomConnection runs through a promise chain, so every
// delivery needs a flush before its effect is observable.
async function deliver(message: unknown): Promise<void> {
  await act(async () => {
    socket.onMessage?.(
      null as unknown as WebSocket,
      { data: JSON.stringify(message) } as MessageEvent,
    )
    await Promise.resolve()
  })
}
//#endregion

//#region Canvas stub
// jsdom has no 2D context; this exposes only what getCanvasState/updateCanvas
// touch, backed by one persistent RGBA buffer the test can read.
const WIDTH = 40
const HEIGHT = 40

function makeMockCanvas() {
  const buffer = new Uint8ClampedArray(WIDTH * HEIGHT * 4)
  const imageData = { data: buffer, width: WIDTH, height: HEIGHT } as unknown as ImageData
  const ctx = {
    getImageData: () => imageData,
    putImageData: () => {},
  } as unknown as CanvasRenderingContext2D
  const canvas = {
    width: WIDTH,
    height: HEIGHT,
    getContext: () => ctx,
  } as unknown as HTMLCanvasElement
  return { canvas, buffer }
}

// A hard red/blue edge: the arrangement where blurring visibly does something,
// so a second application is measurable.
function paintEdge(buffer: Uint8ClampedArray): void {
  for (let y = 5; y < 26; y += 1) {
    for (let x = 5; x < 26; x += 1) {
      const i = (y * WIDTH + x) * 4
      buffer[i] = x < 15 ? 255 : 0
      buffer[i + 1] = 0
      buffer[i + 2] = x < 15 ? 0 : 255
      buffer[i + 3] = 255
    }
  }
}
//#endregion

//#region Fixtures
const ROOM = "room-1"
const ME = "conn-me"
const THEM = "conn-them"

const self: Participant = {
  connectionId: ME,
  name: "Tester",
  color: "#fff",
  isGuest: true,
  role: "guest",
}

const BLUR: BlurInstruction = {
  type: "blur",
  pos: [15, 15],
  radius: 5,
  blend: 2,
  opacity: 100,
  lockAlpha: false,
  instructionId: 1,
  sessionId: "session-a",
} as BlurInstruction

const PENCIL: DrawInstruction = {
  type: "pencil",
  prevPos: [2, 2],
  nextPos: [30, 20],
  color: { r: 0, g: 255, b: 0, a: 255 },
  size: 3,
  instructionId: 2,
  sessionId: "session-a",
} as DrawInstruction

function drawMessage(
  instruction: DrawInstruction,
  connectionId: string | undefined,
  revision: number,
) {
  return { type: "draw", roomId: ROOM, instruction, revision, connectionId }
}

// Renders the hook already joined, with the canvas holding the edge.
async function setup() {
  const { canvas, buffer } = makeMockCanvas()
  paintEdge(buffer)
  renderHook(() =>
    useRoomConnection(
      { current: canvas } as React.RefObject<HTMLCanvasElement>,
      () => {},
      null,
      ROOM,
    ),
  )
  await deliver({
    type: "ready",
    roomId: ROOM,
    self,
    participants: [self],
    openEditing: true,
    hasOwner: false,
    revision: 0,
  })
  return { buffer }
}
//#endregion

describe("useRoomConnection — replaying a draw broadcast", () => {
  beforeEach(() => {
    socket.send.mockClear()
  })

  it("does not re-apply the echo of a blur this client sent", async () => {
    const { buffer } = await setup()

    // The optimistic local apply the blur handler already did at gesture time.
    applyDrawInstructionToCanvas(buffer, BLUR, { width: WIDTH, height: HEIGHT })
    const afterOptimistic = buffer.slice()

    await deliver(drawMessage(BLUR, ME, 1))

    expect(buffer.findIndex((byte, i) => byte !== afterOptimistic[i])).toBe(-1)
  })

  it("applies the same blur when it came from somebody else", async () => {
    const { buffer } = await setup()
    const before = buffer.slice()

    await deliver(drawMessage(BLUR, THEM, 1))

    // Guards the test above against passing for the wrong reason: this blur is
    // one that visibly changes the canvas.
    expect(buffer.findIndex((byte, i) => byte !== before[i])).not.toBe(-1)
  })

  it("still replays the echo of its own non-blur instruction", async () => {
    // Skipping the echo generally would be a desync: an echo carries the order
    // the server put the instruction in, which is what re-establishes
    // last-writer-wins when a collaborator painted the same pixel in between.
    const { buffer } = await setup()
    const before = buffer.slice()

    await deliver(drawMessage(PENCIL, ME, 1))

    expect(buffer.findIndex((byte, i) => byte !== before[i])).not.toBe(-1)
  })

  it("advances the revision on a skipped echo, so no resync is demanded", async () => {
    // The skip must not leave this client looking behind: the 10s heartbeat
    // compares revisions, and a client that never caught up would ask for a full
    // snapshot after every blur.
    await setup()

    await deliver(drawMessage(BLUR, ME, 7))
    await deliver({ type: "revision_check", roomId: ROOM, revision: 7 })

    expect(socket.send).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: "resync" }),
    )
  })

  it("asks to resync when it really is behind", async () => {
    // The counterpart to the test above — proves that assertion can fail.
    await setup()

    await deliver({ type: "revision_check", roomId: ROOM, revision: 9 })

    expect(socket.send).toHaveBeenCalledWith(
      expect.objectContaining({ type: "resync" }),
    )
  })
})
