//#region Imports
import {
  createImageDataFromBytes,
  getCanvasState,
} from "./helperProtocolMethods"
import { handleDrawLineInstruction } from "./handleLineProtocol"
import { handleDrawFillInstruction } from "./handleFillProtocol"
import { handleDrawSprayInstruction } from "./handleSprayProtocol"
import { handleDrawPatchInstruction } from "./handlePatchProtocol"
import { isValidDrawInstruction } from "./validateInstruction"

import type { CanvasDims } from "../constants/canvas"
import type { DrawInstruction } from "../types/drawProtocol"
//#endregion

//#region Patch Apply Mode
// Who is allowed to DECIDE what a patch applies.
//
// Only two callers decide: the server applying a freshly-arrived patch (it is
// the authority), and a client applying its own undo optimistically (it is
// proposing one). Both compare-and-swap, so an entry whose pixel has moved on is
// dropped. Everybody else is REPLAYING a decision that has already been made —
// a client receiving a broadcast, the server rebuilding a room from its event
// log, the playback viewer animating history — and must apply every entry
// unconditionally.
//
// Getting this wrong is not a performance detail, it is a silent desync, and it
// was a real bug (CLAUDE.md §14, fixed by the commit that introduced this type).
// Every tool except patch is unconditional, so ordinary drift heals on the next
// broadcast that touches the pixel. A patch is conditional, so a client that
// re-ran the CAS could SKIP a write the server had applied — and since it still
// advanced `lastRevision` from that message, the revision heartbeat (§5.3) never
// noticed. The client stayed diverged until an unrelated snapshot arrived.
//
// The invariant this restores: a client's canvas is a pure function of its last
// snapshot plus every broadcast since, applied unconditionally in order.
// Optimistic local writes may differ transiently, but every pixel the server
// changed was broadcast, so every difference is eventually overwritten. That is
// what makes optimistic drawing safe.
export type PatchApplyMode = "decide" | "replay"
//#endregion

//#region Server-Driven Canvas Methods
// Applies inst and returns what actually happened. For pencil/eraser/bucket
// this is unconditional — the whole instruction always applies, so it's
// just handed back. For patch (undo/redo) it depends on `mode`: "decide" runs
// the compare-and-swap and returns just the subset that landed (or null if
// nothing did), while "replay" applies every entry and returns all of them.
//
// This is the single fan-in point for every instruction that arrives over the
// network — the server calls it from RoomManager.applyInstruction, and clients
// call it for each broadcast they receive. That makes it the right and only
// place to validate untrusted input: returning null here means the canvas is
// untouched, the revision does not advance, and nothing is broadcast.
//
// `mode` defaults to "decide" because that is what a bare call means: I am the
// one deciding. A caller replaying somebody else's decision has to say so.
export function applyDrawInstructionToCanvas(
  pixels: ImageData | Uint8ClampedArray<ArrayBufferLike>,
  inst: DrawInstruction,
  dims: CanvasDims,
  mode: PatchApplyMode = "decide",
): DrawInstruction | null {
  if (!isValidDrawInstruction(inst, dims)) {
    return null
  }

  // An instruction that changed no pixels is reported as null, exactly like a
  // patch whose every entry lost its compare-and-swap. On the server that is
  // what keeps it out of the timeline: no revision bump, no logged event, no
  // broadcast. Drawing black over black, spraying onto a region already that
  // colour, or bucket-filling a shape with the colour it already has all used to
  // produce history steps that render no visible change, so scrubbing the
  // timeline sat still for stretches of "work" that never happened.
  //
  // The pixels are still WRITTEN either way — this only reports whether any of
  // them ended up different, so a replaying caller (which ignores the return
  // value) is unaffected.
  switch (inst.type) {
    case "pencil":
    case "eraser":
      return handleDrawLineInstruction(pixels, inst, dims) > 0 ? inst : null
    case "bucket":
      return handleDrawFillInstruction(pixels, inst, dims) > 0 ? inst : null
    case "spray":
      return handleDrawSprayInstruction(pixels, inst, dims) > 0 ? inst : null
    case "clear": {
      // Blank every byte — R, G, B and A all to 0 (fully transparent).
      const buffer = pixels instanceof Uint8ClampedArray ? pixels : pixels.data
      buffer.fill(0)
      return inst
    }
    case "patch": {
      const applied = handleDrawPatchInstruction(pixels, inst, mode)
      if (applied.length === 0) {
        return null
      }
      return { ...inst, entries: applied }
    }
  }
}

// Replaces the canvas wholesale from a snapshot's raw RGBA bytes. A payload of
// the wrong size is dropped rather than applied, leaving the previous canvas up:
// stale pixels that the next revision_check will correct are strictly better
// than a blank or corrupted board.
export function applySnapshotToCanvas(
  canvas: HTMLCanvasElement,
  pixels: Uint8Array,
  dims: CanvasDims,
): void {
  // Size the element to the snapshot's dims FIRST — this is where a live resize
  // takes effect on the client, because getCanvasState drops the stale cache and
  // rebuilds at the new size when the dimensions change.
  const canvasState = getCanvasState(canvas, dims)
  if (!canvasState) {
    return
  }

  const imageData = createImageDataFromBytes(pixels, dims)
  if (imageData === null) {
    return
  }

  canvasState.imageData = imageData
  canvasState.ctx.putImageData(canvasState.imageData, 0, 0)
}
//#endregion
