//#region Imports
import { CANVAS_HEIGHT, CANVAS_WIDTH, DEFAULT_COLOR } from "../constants/canvas"

import type { ToolType, PatchEntry } from "../types/drawProtocol"
import type { ColorPallet, ColorType, Vec } from "../types/primitive"
//#endregion

//#region Type Defs
export type CanvasState = {
  ctx: CanvasRenderingContext2D
  imageData: ImageData
}

export type PixelColorMethod = (idx: number) => ColorType
export type PixelInteractionMethod = (idx: number, color: ColorType) => void
//#endregion

//#region Constants
const canvasStates = new WeakMap<HTMLCanvasElement, CanvasState>()
//#endregion

//#region Helper Methods
export function clamp(val: number, min: number, max: number): number {
  return Math.max(Math.min(val, max), min)
}
// `<< 2` multiplies by 4: one pixel is 4 bytes (RGBA), so a vector maps to a
// byte offset, not a pixel index.
export function getIdxFromVec(vec: Vec): number {
  return (vec[1] * CANVAS_WIDTH + vec[0]) << 2
}
// NOTE: a `getVecFromIdx` inverse used to live here. It was dead code AND
// wrong — it divided by CANVAS_WIDTH without first dividing the byte offset by
// 4, so getVecFromIdx(getIdxFromVec([1, 0])) returned [4, 0] rather than
// [1, 0]. Removed rather than fixed: nothing called it, and an untested
// "helper" that silently returns the wrong pixel is a trap for whoever reaches
// for it first. Re-add it with tests if a real caller appears.

export function createImageDataFromBase64(data: string): ImageData {
  const binary = atob(data)
  const bytes = new Uint8ClampedArray(binary.length)

  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i)
  }

  return new ImageData(bytes, CANVAS_WIDTH, CANVAS_HEIGHT)
}
//#endregion

//#region Canvas Methods
export function getCanvasState(canvas: HTMLCanvasElement): CanvasState | null {
  if (canvas.width !== CANVAS_WIDTH || canvas.height !== CANVAS_HEIGHT) {
    canvas.width = CANVAS_WIDTH
    canvas.height = CANVAS_HEIGHT
  }

  const ctx = canvas.getContext("2d")
  if (!ctx) {
    return null
  }

  const cached = canvasStates.get(canvas)
  if (cached) {
    return cached
  }

  const state: CanvasState = {
    ctx,
    imageData: ctx.getImageData(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT),
  }
  canvasStates.set(canvas, state)
  return state
}
export function updateCanvas(canvas: HTMLCanvasElement): void {
  const canvasState = getCanvasState(canvas)
  if (canvasState === null) {
    return
  }

  canvasState.ctx.putImageData(canvasState.imageData, 0, 0)
}

// Returns raw canvas coordinates, which may be OUTSIDE the canvas when the
// pointer is. Callers must clip or clamp before touching pixels.
export function getPos(ev: PointerEvent, canvas: HTMLCanvasElement): Vec {
  const rect = canvas.getBoundingClientRect()
  const scaleX = CANVAS_WIDTH / rect.width
  const scaleY = CANVAS_HEIGHT / rect.height

  const x = Math.floor((ev.clientX - rect.left) * scaleX)
  const y = Math.floor((ev.clientY - rect.top) * scaleY)

  return [x, y]
}

// Clips the segment a->b to the canvas rectangle (Liang-Barsky), returning the
// visible portion, or null if the segment misses the canvas entirely.
//
// This is what lets a stroke reach the edge when the pointer runs off it.
// Clamping each axis independently — the old behaviour — is NOT equivalent:
// clamping (200, 60) to (119, 60) bends the line toward that point, whereas the
// segment from (50, 50) actually leaves the canvas at (119, 55). For a fast
// flick to a corner the difference is very visible.
//
// Both returned endpoints are guaranteed in-bounds, which is what the wire
// protocol requires (see validateInstruction).
export function clipSegmentToCanvas(a: Vec, b: Vec): [Vec, Vec] | null {
  if (
    !Number.isFinite(a[0]) ||
    !Number.isFinite(a[1]) ||
    !Number.isFinite(b[0]) ||
    !Number.isFinite(b[1])
  ) {
    return null
  }

  const xMin = 0
  const yMin = 0
  const xMax = CANVAS_WIDTH - 1
  const yMax = CANVAS_HEIGHT - 1

  const dx = b[0] - a[0]
  const dy = b[1] - a[1]

  // Liang-Barsky: walk the parametric line a + t*(b-a) for t in [0,1] and
  // shrink the interval against each of the four edges.
  let t0 = 0
  let t1 = 1

  const p = [-dx, dx, -dy, dy]
  const q = [a[0] - xMin, xMax - a[0], a[1] - yMin, yMax - a[1]]

  for (let i = 0; i < 4; i += 1) {
    if (p[i] === 0) {
      // Parallel to this edge: if it starts outside it, it never comes in.
      if (q[i] < 0) {
        return null
      }
      continue
    }

    const r = q[i] / p[i]
    if (p[i] < 0) {
      if (r > t1) {
        return null
      }
      if (r > t0) {
        t0 = r
      }
    } else {
      if (r < t0) {
        return null
      }
      if (r < t1) {
        t1 = r
      }
    }
  }

  // Rounding can land a hair outside, so clamp defensively — the caller writes
  // straight into the pixel buffer with these.
  const at = (t: number): Vec => [
    clamp(Math.round(a[0] + t * dx), xMin, xMax),
    clamp(Math.round(a[1] + t * dy), yMin, yMax),
  ]

  return [at(t0), at(t1)]
}
export function getPosCorrected(
  ev: PointerEvent,
  canvas: HTMLCanvasElement,
): [Vec, boolean] {
  const [x, y] = getPos(ev, canvas)

  const correctedX = clamp(x, 0, CANVAS_WIDTH - 1)
  const correctedY = clamp(y, 0, CANVAS_HEIGHT - 1)

  if (x !== correctedX || y !== correctedY) {
    return [[correctedX, correctedY], false]
  }

  return [[x, y], true]
}
//#endregion

//#region ToolType Methods
export function getLookAtMethod(
  _type: string,
  imageData: ImageData | Uint8ClampedArray,
): PixelColorMethod {
  const image =
    imageData instanceof Uint8ClampedArray ? imageData : imageData.data

  return (idx: number): ColorType => {
    return {
      r: image[idx + 0],
      g: image[idx + 1],
      b: image[idx + 2],
      a: image[idx + 3],
    }
  }
}
export function getDrawerMethod(
  _type: string,
  imageData: ImageData | Uint8ClampedArray,
): PixelInteractionMethod {
  const image =
    imageData instanceof Uint8ClampedArray ? imageData : imageData.data

  return (idx: number, color: ColorType): void => {
    image[idx + 0] = color.r
    image[idx + 1] = color.g
    image[idx + 2] = color.b
    image[idx + 3] = color.a
  }
}

// Wraps a setColor callback so every write also records what was there
// beforehand. Used only on the client, only while actively drawing, to
// build the local undo entry for free off the same pixel-write loop
// setPixelLine/setPixelFill already run — no separate diffing pass.
export function withRecording(
  getColor: PixelColorMethod,
  setColor: PixelInteractionMethod,
  sink: PatchEntry[],
): PixelInteractionMethod {
  return (idx: number, color: ColorType): void => {
    sink.push({ idx, from: getColor(idx), to: color })
    setColor(idx, color)
  }
}
//#endregion

//#region Color Methods
export function getDirectColor(cp: ColorPallet, ev: PointerEvent): ColorType {
  if (ev.pointerType !== "mouse") {
    return cp.primary
  }
  if (ev.button === 2 || (ev.buttons & 2) === 2) {
    return cp.secondary
  }
  return cp.primary
}

export function getToolColor(type: ToolType, baseColor: ColorType): ColorType {
  if (type === "eraser") {
    return DEFAULT_COLOR
  }
  return baseColor
}
//#endregion
