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
import { applyDrawInstructionToCanvas } from "../handleCanvasProtocol"
import { getIdxFromVec } from "../helperProtocolMethods"

import {
  BASE,
  BLUE,
  GREEN,
  RED,
  TRANSPARENT,
  makeCanvas,
} from "./testHelpers"

import type { DrawInstruction } from "../../types/drawProtocol"
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
    // Returns what the server broadcast, so a test can assert on the narrowing.
    deliver(instruction: DrawInstruction): DrawInstruction | null {
      const applied = applyDrawInstructionToCanvas(server, instruction)
      if (applied === null) {
        // Rejected or no-op: nothing is broadcast, so no client hears anything.
        return null
      }
      clients.forEach((pixels) => applyDrawInstructionToCanvas(pixels, applied))
      return applied
    },
  }
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
    const kept = getIdxFromVec([1, 1])
    const clobbered = getIdxFromVec([2, 2])

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
    applyDrawInstructionToCanvas(sender, stroke)
    // Then the round trip: server applies and broadcasts back to the sender.
    room.deliver(stroke)

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

  // KNOWN DIVERGENCE — documented, not yet fixed. See CLAUDE.md §14.
  //
  // `it.fails` asserts the body DOES fail, so this test is green while the bug
  // exists and turns RED the moment someone fixes it — at which point delete the
  // `.fails` and the §14 entry together. A skipped test would rot silently; this
  // one cannot.
  //
  // The bug: clients re-run the compare-and-swap on a patch the SERVER has
  // already run it on. Every other tool is unconditional, so any local drift
  // heals on the next broadcast that touches the pixel. A patch is conditional,
  // so if a client's optimistic undo moved the pixel off the value an incoming
  // remote patch expects, the client SKIPS a write the server applied — and
  // because the client still advances `lastRevision` from that message, the
  // revision heartbeat (§5.3) never notices. It is silently diverged until an
  // unrelated snapshot happens to arrive.
  //
  // The fix is small and points at the narrowing above: the server has already
  // decided what applies, so a broadcast patch should be applied
  // UNCONDITIONALLY by clients. Only the local optimistic path should CAS. That
  // needs the fan-in point to distinguish the two callers, which is a sync-model
  // change and so its own commit, not a drive-by.
  it.fails("DIVERGES: two concurrent patches, one applied optimistically", () => {
    const room = makeRoom(1)
    const [clientA] = room.clients
    const idx = getIdxFromVec([1, 1])

    room.deliver({ type: "pencil", prevPos: [1, 1], nextPos: [1, 1], color: RED, ...BASE })

    // A undoes locally and optimistically, before the server has seen it.
    applyDrawInstructionToCanvas(clientA, {
      type: "patch",
      entries: [{ idx, from: RED, to: TRANSPARENT }],
      ...BASE,
    })

    // Meanwhile B's undo of the same pixel reaches the server first and applies.
    room.deliver({
      type: "patch",
      entries: [{ idx, from: RED, to: BLUE }],
      ...BASE,
    })

    // A's pixel is TRANSPARENT, not the RED that patch expected, so A skips it
    // while the server applied it. Server holds BLUE, A holds TRANSPARENT.
    expectConverged(room.server, room.clients)
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
