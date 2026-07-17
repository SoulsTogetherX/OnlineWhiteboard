//#region Imports
import {
  clipSegmentToCanvas,
  getCanvasState,
  getDrawerMethod,
  getIdxFromVec,
  getPos,
  updateCanvas,
  withRecording,
  getLookAtMethod,
} from "./helperProtocallMethods"

import { DEFAULT_COLOR } from "../constants/canvas"

import type {
  BaseInstruction,
  LineAction,
  LineInstruction,
  PatchEntry,
} from "../types/drawProtocol"
import type { ColorType, Vec } from "../types/primitive"
//#endregion

//#region Helper Method
function setPixelLine(
  action: LineAction,
  color: ColorType,
  setPixel: (idx: number, color: ColorType) => void,
): void {
  if (!action.prevPos || !action.nextPos) {
    return
  }

  let x0 = action.prevPos[0]
  let y0 = action.prevPos[1]
  const x1 = action.nextPos[0]
  const y1 = action.nextPos[1]

  const dx = Math.abs(x1 - x0)
  const dy = Math.abs(y1 - y0)
  const sx = x0 < x1 ? 1 : -1
  const sy = y0 < y1 ? 1 : -1

  let err = dx - dy
  while (true) {
    setPixel(getIdxFromVec([x0, y0]), color)

    if (x0 === x1 && y0 === y1) {
      break
    }

    const e2 = err << 1
    if (e2 > -dy) {
      err -= dy
      x0 += sx
    }
    if (e2 < dx) {
      err += dx
      y0 += sy
    }
  }
}

// Builds the wire instruction from an already-clipped segment, NOT from the
// action's raw positions — those may be off-canvas, and the protocol requires
// in-bounds endpoints (see validateInstruction).
function createInstruction(
  da: LineAction,
  base: BaseInstruction,
  prevPos: Vec,
  nextPos: Vec,
): LineInstruction {
  return {
    ...base,
    type: da.type,
    prevPos,
    nextPos,
  } as LineInstruction
}

function handleDraw(
  canvas: HTMLCanvasElement,
  base: BaseInstruction,
  da: LineAction,
  ev: PointerEvent,
  record?: PatchEntry[],
): LineInstruction | null {
  // RAW position, deliberately unclamped. The action tracks where the pointer
  // actually is — including off-canvas — because the next segment's geometry
  // depends on it: coming back on-screen from (200, 60) must re-enter at the
  // point the real line crosses the edge, which is unknowable if we only stored
  // a clamped (119, 60).
  const rawNext = getPos(ev, canvas)

  da.prevPos = da.nextPos ?? rawNext
  da.nextPos = rawNext

  // Previously this bailed out whenever the pointer was outside the canvas
  // (`if (next[1] === false) return null`), which is why a stroke stopped at the
  // last in-bounds sample instead of running to the edge. Now the segment is
  // clipped to the canvas and the visible part is drawn; only a segment that
  // misses the canvas completely (both ends outside, e.g. moving around beyond
  // the edge) draws nothing.
  const segment = clipSegmentToCanvas(da.prevPos, da.nextPos)
  if (segment === null) {
    return null
  }

  const canvasState = getCanvasState(canvas)
  if (canvasState === null) {
    return null
  }

  let drawer = getDrawerMethod(da.type, canvasState.imageData)
  if (record) {
    const getColor = getLookAtMethod(da.type, canvasState.imageData)
    drawer = withRecording(getColor, drawer, record)
  }

  const [prevPos, nextPos] = segment
  setPixelLine(
    { ...da, prevPos, nextPos },
    base.color ?? DEFAULT_COLOR,
    drawer,
  )
  updateCanvas(canvas)
  return createInstruction(da, base, prevPos, nextPos)
}
//#endregion

//#region Handle Methods
export function handleDrawLineStart(
  canvas: HTMLCanvasElement,
  base: BaseInstruction,
  da: LineAction,
  ev: PointerEvent,
  record?: PatchEntry[],
): LineInstruction | null {
  // A gesture always starts on the canvas — useDrag binds pointerdown to the
  // canvas element itself — so this is in-bounds by construction. Seed both
  // ends to it so the first handleDraw paints a single dot.
  const start = getPos(ev, canvas)

  da.prevPos = start
  da.nextPos = start
  return handleDraw(canvas, base, da, ev, record)
}
export function handleDrawLineFinish(
  _canvas: HTMLCanvasElement,
  _base: BaseInstruction,
  _da: LineAction,
  _ev: PointerEvent,
): LineInstruction | null {
  return null
}
export function handleDrawLineMotion(
  canvas: HTMLCanvasElement,
  base: BaseInstruction,
  da: LineAction,
  ev: PointerEvent,
  record?: PatchEntry[],
): LineInstruction | null {
  return handleDraw(canvas, base, da, ev, record)
}
export function handleDrawLineLeave(
  canvas: HTMLCanvasElement,
  base: BaseInstruction,
  da: LineAction,
  ev: PointerEvent,
  record?: PatchEntry[],
): LineInstruction | null {
  return handleDraw(canvas, base, da, ev, record)
}
export function handleDrawLineInstruction(
  pixels: ImageData | Uint8ClampedArray<ArrayBufferLike>,
  inst: LineInstruction,
): void {
  const drawer = getDrawerMethod(inst.type, pixels)
  setPixelLine(inst, inst.color ?? DEFAULT_COLOR, drawer)
}
//#endregion
