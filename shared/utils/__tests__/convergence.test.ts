//#region Why this exists
// Every other test in this folder asks "did this instruction paint the right
// pixels?". This one asks the question the whole architecture rests on: after a
// stream of instructions, does every client's buffer hold the SAME bytes as the
// server's?
//
// That property is what `shared/` exists to guarantee (CLAUDE.md §4), and until
// now nothing asserted it. It is also the exact failure mode Phase 3 risks:
// a mistake in the snapshot encoding or in the 100 ms hold does not crash, it
// silently desynchronises one client from the server — which no per-instruction
// test would notice, because each instruction is applied correctly in isolation.
//
// The model here mirrors the real topology deliberately:
//
//   server: applied = applyDrawInstructionToCanvas(serverPixels, incoming)
//           broadcast(applied)          <- the NARROWED instruction, not `incoming`
//   client: applyDrawInstructionToCanvas(clientPixels, applied)
//
// Broadcasting `applied` rather than `incoming` is the load-bearing detail for
// patches (§5.4): a compare-and-swap patch applies only where the pixel still
// matches, so the server and a client that saw a different history would narrow
// it DIFFERENTLY if each ran the CAS itself. Test 4 pins that.
//#endregion

//#region Imports
import { describe, expect, it } from "vitest"

import { MAX_SPRAY_DENSITY, MAX_SPRAY_RADIUS } from "../../constants/canvas"
import {
  applyDrawInstructionToCanvas,
  isIdempotentOnReplay,
} from "../handleCanvasProtocol"
import { getIdxFromVec } from "../helperProtocolMethods"

import {
  BASE,
  BLUE,
  DIMS,
  GREEN,
  RED,
  TRANSPARENT,
  getPixel,
  makeCanvas,
  setPixel,
} from "./testHelpers"

import type { DrawInstruction, PatchEntry } from "../../types/drawProtocol"
//#endregion

//#region Harness
// One simulated room: a server buffer plus N client buffers, all starting blank.
// `deliver` runs the real server path (apply, then broadcast what actually
// applied) and fans the result out to every client, exactly as RoomManager does.
function makeRoom(clientCount: number) {
  const server = makeCanvas()
  const clients = Array.from({ length: clientCount }, () => makeCanvas())

  return {
    server,
    clients,
    // `origin` is the index of the client that SENT this, for the tests that
    // model a round trip. The sender already applied it optimistically, so it
    // runs the same rule the real client does (useRoomConnection): replay every
    // echo except one whose second application would not land on the same
    // pixels. Omitted, nobody in the room is the sender and everyone replays.
    //
    // Returns what the server broadcast, so a test can assert on the narrowing.
    deliver(
      instruction: DrawInstruction,
      origin?: number,
    ): DrawInstruction | null {
      const applied = applyDrawInstructionToCanvas(server, instruction, DIMS)
      if (applied === null) {
        // Rejected or no-op: nothing is broadcast, so no client hears anything.
        return null
      }
      // Clients REPLAY: the server already decided. This asymmetry is the whole
      // point — see PatchApplyMode in handleCanvasProtocol.ts.
      clients.forEach((pixels, client) => {
        if (client === origin && !isIdempotentOnReplay(applied)) {
          return
        }
        applyDrawInstructionToCanvas(pixels, applied, DIMS, "replay")
      })
      return applied
    },
  }
}

// The undo entries a client records for a gesture: one per pixel it actually
// changed, holding the colour from before and the colour after. Built here by
// diffing the two buffers, which is exactly the set withRecording +
// coalesceRecording produce off the live pixel-write loop (same pixels, same
// from/to, from-equals-to dropped) without needing a canvas element.
function recordedUndoEntries(
  before: Uint8ClampedArray,
  after: Uint8ClampedArray,
): PatchEntry[] {
  const entries: PatchEntry[] = []
  for (let i = 0; i < before.length; i += 4) {
    const changed =
      before[i] !== after[i] ||
      before[i + 1] !== after[i + 1] ||
      before[i + 2] !== after[i + 2] ||
      before[i + 3] !== after[i + 3]
    if (changed) {
      entries.push({
        idx: i,
        from: { r: before[i], g: before[i + 1], b: before[i + 2], a: before[i + 3] },
        to: { r: after[i], g: after[i + 1], b: after[i + 2], a: after[i + 3] },
      })
    }
  }
  return entries
}

// Reverses a recording's direction, exactly as useUndoRedo does before applying
// it: undo replays the gesture backwards.
function reversed(entries: PatchEntry[]): PatchEntry[] {
  return entries.map((e) => ({ idx: e.idx, from: e.to, to: e.from }))
}

// A hard red/blue edge — the arrangement where blurring visibly does something,
// so "did the blur land twice" is measurable.
function paintEdge(pixels: Uint8ClampedArray): void {
  for (let y = 5; y < 16; y += 1) {
    for (let x = 5; x < 16; x += 1) {
      setPixel(pixels, x, y, x < 10 ? RED : BLUE)
    }
  }
}

function blurAt(pos: [number, number]): DrawInstruction {
  return {
    type: "blur",
    pos,
    radius: 4,
    blend: 2,
    opacity: 100,
    lockAlpha: false,
    ...BASE,
  } as DrawInstruction
}

// Byte-for-byte equality against the server, reported as the first differing
// index rather than a 57,600-element diff — a raw toEqual on two typed arrays
// produces output nobody can read.
function expectConverged(
  server: Uint8ClampedArray,
  clients: Uint8ClampedArray[],
): void {
  clients.forEach((pixels, client) => {
    expect(pixels.length).toBe(server.length)
    const diff = pixels.findIndex((byte, i) => byte !== server[i])
    expect({ client, diff }).toEqual({ client, diff: -1 })
  })
}
//#endregion

//#region Tests
describe("convergence — every client ends byte-identical to the server", () => {
  it("converges across a mixed stream of every tool", () => {
    const room = makeRoom(3)

    const stream: DrawInstruction[] = [
      { type: "pencil", prevPos: [2, 2], nextPos: [40, 30], color: RED, size: 3, ...BASE },
      { type: "spray", pos: [60, 60], radius: 8, density: 40, seed: 12345, color: BLUE, ...BASE },
      { type: "pencil", prevPos: [40, 30], nextPos: [80, 90], color: GREEN, size: 1, ...BASE },
      { type: "bucket", pos: [110, 110], color: BLUE, ...BASE },
      { type: "eraser", prevPos: [10, 10], nextPos: [50, 50], size: 5, ...BASE },
      { type: "spray", pos: [20, 100], radius: 12, density: 60, seed: 999, color: RED, ...BASE },
    ]

    stream.forEach((instruction) => room.deliver(instruction))

    expectConverged(room.server, room.clients)
  })

  it("converges on the spray can, which reproduces its splatter from a seed", () => {
    // The spray carries a seed, not a pixel list (§5.2). If mulberry32 were ever
    // replaced by anything unseeded, this is the test that catches it — every
    // client would splatter differently and drift from the server.
    const room = makeRoom(4)

    room.deliver({
      type: "spray",
      pos: [64, 64],
      // At the caps, not past them: a density of 200 is REJECTED, and a rejected
      // instruction converges vacuously (nothing is applied anywhere), which is
      // precisely what the painted-something assertion below exists to catch.
      radius: MAX_SPRAY_RADIUS,
      density: MAX_SPRAY_DENSITY,
      seed: 0x5eed,
      color: RED,
      ...BASE,
    })

    expectConverged(room.server, room.clients)
    // Guard against the degenerate pass where nothing was painted at all.
    expect(room.server.some((byte) => byte !== 0)).toBe(true)
  })

  it("converges when a clear lands mid-stream", () => {
    const room = makeRoom(2)

    room.deliver({ type: "bucket", pos: [5, 5], color: GREEN, ...BASE })
    room.deliver({ type: "clear", ...BASE })
    room.deliver({ type: "pencil", prevPos: [0, 0], nextPos: [20, 20], color: RED, size: 2, ...BASE })

    expectConverged(room.server, room.clients)
  })

  it("converges on a patch that the server narrowed to its applied subset", () => {
    // The scenario the CAS design exists for. The server's canvas has GREEN at
    // one of the two pixels the patch wants to undo, so that entry is skipped
    // and only the other applies.
    //
    // Worth being precise about what this does and does not prove. Broadcasting
    // the NARROWED patch rather than the original is a bandwidth and
    // undo-stack-accuracy decision, NOT what makes synced clients converge:
    // compare-and-swap is deterministic, so a client holding the same bytes as
    // the server narrows the original identically. Verified by temporarily
    // broadcasting `instruction` instead of `applied` — all seven tests still
    // passed. The case where it genuinely matters is the one below.
    const room = makeRoom(2)
    const kept = getIdxFromVec([1, 1], DIMS)
    const clobbered = getIdxFromVec([2, 2], DIMS)

    // Paint RED at both, everywhere, through the normal path so server and
    // clients agree on the starting state.
    room.deliver({ type: "pencil", prevPos: [1, 1], nextPos: [1, 1], color: RED, ...BASE })
    room.deliver({ type: "pencil", prevPos: [2, 2], nextPos: [2, 2], color: RED, ...BASE })
    // Now a collaborator paints GREEN over the second pixel.
    room.deliver({ type: "pencil", prevPos: [2, 2], nextPos: [2, 2], color: GREEN, ...BASE })

    const applied = room.deliver({
      type: "patch",
      entries: [
        { idx: kept, from: RED, to: BLUE },
        { idx: clobbered, from: RED, to: BLUE },
      ],
      ...BASE,
    })

    // The server narrowed the patch to the single entry that passed the CAS.
    expect(applied).not.toBeNull()
    expect(applied?.type).toBe("patch")
    expect(applied?.type === "patch" && applied.entries).toHaveLength(1)
    expectConverged(room.server, room.clients)
  })

  it("keeps a client converged when it re-applies its own echoed instruction", () => {
    // The server broadcasts to EVERYONE including the sender (§5.2), so each
    // client applies its own stroke twice: once optimistically, once on echo.
    // Re-application must be idempotent or the sender drifts from everyone else.
    const room = makeRoom(1)
    const sender = room.clients[0]

    const stroke: DrawInstruction = {
      type: "pencil",
      prevPos: [3, 3],
      nextPos: [30, 45],
      color: RED,
      size: 4,
      ...BASE,
    }

    // Optimistic local paint, before the server has seen anything.
    applyDrawInstructionToCanvas(sender, stroke, DIMS)
    // Then the round trip: server applies and broadcasts back to the sender.
    room.deliver(stroke)

    expectConverged(room.server, room.clients)
  })

  it("keeps the sender converged when it echoes back its own blur", () => {
    // The same round trip as the test above, for the one tool that is NOT
    // idempotent. A blur is computed FROM the canvas, so replaying it over its
    // own output blurs twice: the sender used to end up visibly softer than the
    // server and than everybody else, permanently — no revision was missed, so
    // the heartbeat never asked for a resync.
    const room = makeRoom(2)
    const [sender, bystander] = room.clients
    ;[room.server, sender, bystander].forEach(paintEdge)

    const stroke = blurAt([10, 10])
    // Optimistic local paint, before the server has seen anything.
    applyDrawInstructionToCanvas(sender, stroke, DIMS)
    // The round trip: the server applies and broadcasts back to the whole room,
    // sender included.
    room.deliver(stroke, 0)

    expectConverged(room.server, room.clients)
    // Not a vacuous pass: the blur really did soften the edge.
    expect(getPixel(room.server, 9, 10)).not.toEqual(RED)
  })

  it("undoes a blur completely, back to the pixels it started from", () => {
    // The bug this file's blur cases exist for. Undo is a compare-and-swap
    // patch: each entry only applies while the pixel still holds the colour the
    // gesture left there. When the sender replayed its own blur echo, every one
    // of those pixels moved again, so every CAS failed — undo lit up, applied
    // nothing, and reported the area as already changed.
    const room = makeRoom(1)
    const [sender] = room.clients
    ;[room.server, sender].forEach(paintEdge)
    const beforeBlur = sender.slice()

    // A gesture is one instruction per pointer sample, each applied
    // optimistically, recorded, and sent — so the recording spans all of them
    // and overlapping puffs compound, which is what makes the last-write-wins
    // coalescing matter.
    const gesture = [blurAt([10, 10]), blurAt([11, 10]), blurAt([11, 11])]
    for (const puff of gesture) {
      applyDrawInstructionToCanvas(sender, puff, DIMS)
    }
    const undoEntries = recordedUndoEntries(beforeBlur, sender)
    expect(undoEntries.length).toBeGreaterThan(0)

    // Every puff round trips and comes back to the whole room.
    for (const puff of gesture) {
      room.deliver(puff, 0)
    }
    expectConverged(room.server, room.clients)

    // Now undo, exactly as useUndoRedo does it: reverse the recording and apply
    // it locally in "decide" mode — this client is PROPOSING the patch, so it
    // runs the compare-and-swap itself. This is the step that used to come back
    // empty.
    const proposed = applyDrawInstructionToCanvas(
      sender,
      { type: "patch", entries: reversed(undoEntries), ...BASE },
      DIMS,
    )
    expect(proposed?.type === "patch" && proposed.entries).toHaveLength(
      undoEntries.length,
    )

    // Only what landed is sent on, and the server decides again from its own
    // canvas.
    const undone = room.deliver(proposed as DrawInstruction, 0)

    // Nothing was narrowed away on either side: every pixel the gesture touched
    // was restored.
    expect(undone?.type === "patch" && undone.entries).toHaveLength(
      undoEntries.length,
    )
    expect(sender.findIndex((byte, i) => byte !== beforeBlur[i])).toBe(-1)
    expectConverged(room.server, room.clients)
  })

  it("does not diverge when the server rejects a hostile instruction", () => {
    // A rejected instruction must be invisible: no canvas mutation on the server
    // and nothing broadcast, so clients never hear about it at all.
    const room = makeRoom(2)

    room.deliver({ type: "pencil", prevPos: [1, 1], nextPos: [10, 10], color: RED, ...BASE })
    const before = room.server.slice()

    const rejected = room.deliver({
      type: "pencil",
      prevPos: [0, 0],
      // The coordinate that once froze the event loop (§13.2).
      nextPos: [1e9, 1e9],
      color: BLUE,
      ...BASE,
    })

    expect(rejected).toBeNull()
    expect(room.server).toEqual(before)
    expectConverged(room.server, room.clients)
  })

  // The regression test for the divergence the harness found. Before clients
  // replayed instead of re-deciding, this ended with the server holding BLUE and
  // the client holding TRANSPARENT — permanently, because the client still
  // advanced its revision and so never asked to resync.
  it("converges: two concurrent patches, one applied optimistically", () => {
    const room = makeRoom(1)
    const [clientA] = room.clients
    const idx = getIdxFromVec([1, 1], DIMS)

    room.deliver({ type: "pencil", prevPos: [1, 1], nextPos: [1, 1], color: RED, ...BASE })

    // A undoes locally and optimistically, before the server has seen it.
    applyDrawInstructionToCanvas(clientA, {
      type: "patch",
      entries: [{ idx, from: RED, to: TRANSPARENT }],
      ...BASE,
    }, DIMS)

    // Meanwhile B's undo of the same pixel reaches the server first and applies.
    room.deliver({
      type: "patch",
      entries: [{ idx, from: RED, to: BLUE }],
      ...BASE,
    })

    // A's pixel is TRANSPARENT, not the RED that patch expected. Under "decide"
    // A would skip a write the server made; under "replay" it applies it and
    // lands on the server's BLUE.
    expectConverged(room.server, room.clients)
    expect(getPixel(room.server, 1, 1)).toEqual(BLUE)
  })

  it("re-converges a client that fell behind and was reset from the server's bytes", () => {
    // The resync path (§5.3): a client that missed instructions is not patched
    // up, it is replaced wholesale with the server's buffer. Anything that makes
    // a snapshot round trip lossy shows up here.
    const room = makeRoom(2)
    const [, straggler] = room.clients

    room.deliver({ type: "bucket", pos: [50, 50], color: BLUE, ...BASE })
    room.deliver({ type: "pencil", prevPos: [0, 0], nextPos: [119, 119], color: RED, size: 6, ...BASE })

    // Simulate the straggler having missed everything, then being handed a
    // snapshot of the server's current bytes.
    straggler.fill(0)
    straggler.set(room.server)

    // Play on from there; both clients must stay together.
    room.deliver({ type: "spray", pos: [30, 30], radius: 10, density: 50, seed: 7, color: GREEN, ...BASE })

    expectConverged(room.server, room.clients)
  })
})
//#endregion
