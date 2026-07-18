//#region Imports
import {
  createImageDataFromBase64,
  getCanvasState,
} from "./helperProtocallMethods"
import { handleDrawLineInstruction } from "./handleLineProtocall"
import { handleDrawFillInstruction } from "./handleFillProtocall"
import { handleDrawSprayInstruction } from "./handleSprayProtocol"
import { handleDrawPatchInstruction } from "./handlePatchProtocol"
import { isValidDrawInstruction } from "./validateInstruction"

import type { DrawInstruction } from "../types/drawProtocol"
//#endregion

//#region Server-Driven Canvas Methods
// Applies inst and returns what actually happened. For pencil/eraser/bucket
// this is unconditional — the whole instruction always applies, so it's
// just handed back. For patch (undo/redo) it's conditional — only entries
// that passed the compare-and-swap check applied, so a new instruction
// carrying just that subset is returned, or null if nothing applied at all.
//
// This is the single fan-in point for every instruction that arrives over the
// network — the server calls it from RoomManager.applyInstruction, and clients
// call it for each broadcast they receive. That makes it the right and only
// place to validate untrusted input: returning null here means the canvas is
// untouched, the revision does not advance, and nothing is broadcast.
export function applyDrawInstructionToCanvas(
  pixels: ImageData | Uint8ClampedArray<ArrayBufferLike>,
  inst: DrawInstruction,
): DrawInstruction | null {
  if (!isValidDrawInstruction(inst)) {
    return null
  }

  switch (inst.type) {
    case "pencil":
    case "eraser":
      handleDrawLineInstruction(pixels, inst)
      return inst
    case "bucket":
      handleDrawFillInstruction(pixels, inst)
      return inst
    case "spray":
      handleDrawSprayInstruction(pixels, inst)
      return inst
    case "patch": {
      const applied = handleDrawPatchInstruction(pixels, inst)
      if (applied.length === 0) {
        return null
      }
      return { ...inst, entries: applied }
    }
  }
}

export function applySnapshotToCanvas(
  canvas: HTMLCanvasElement,
  data: string,
): void {
  const canvasState = getCanvasState(canvas)
  if (!canvasState) {
    return
  }

  canvasState.imageData = createImageDataFromBase64(data)
  canvasState.ctx.putImageData(canvasState.imageData, 0, 0)
}
//#endregion
