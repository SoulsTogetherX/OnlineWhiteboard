//#region Imports
import { DEFAULT_COLOR, canvasBytes } from "../constants/canvas"
import { colorsEqual } from "../types/primitive"

import type { CanvasDims } from "../constants/canvas"

import type { ToolType, PatchEntry } from "../types/drawProtocol"
import type { ColorPalette, ColorType, Vec } from "../types/primitive"
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

// The room's dimensions as carried by the canvas element itself. Once a snapshot
// has sized the element (applySnapshotToCanvas), the element IS the source of
// truth for this connection's canvas size, so client-side draw handlers read
// their dims from here rather than a constant or a separate ref.
export function canvasDimsOf(canvas: HTMLCanvasElement): CanvasDims {
  return { width: canvas.width, height: canvas.height }
}
// A vector maps to a BYTE offset (not a pixel index): the row stride is the
// canvas width, and each pixel is four bytes of RGBA. The stride is now per-room,
// so it comes from `dims` rather than a module constant.
export function getIdxFromVec(vec: Vec, dims: CanvasDims): number {
  return (vec[1] * dims.width + vec[0]) * 4
}
// NOTE: a `getVecFromIdx` inverse used to live here. It was dead code AND
// wrong — it divided by CANVAS_WIDTH without first dividing the byte offset by
// 4, so getVecFromIdx(getIdxFromVec([1, 0])) returned [4, 0] rather than
// [1, 0]. Removed rather than fixed: nothing called it, and an untested
// "helper" that silently returns the wrong pixel is a trap for whoever reaches
// for it first. Re-add it with tests if a real caller appears.

// Wraps raw RGBA bytes as ImageData, or returns null if there are not exactly
// the right number of them.
//
// The length check is not defensive padding: `new ImageData` THROWS when the
// buffer does not match the dimensions, and this runs inside the socket message
// handler, so a short or oversized payload would take out the whole handler
// rather than dropping one bad frame. Returning null lets the caller skip it the
// same way it skips a malformed message.
export function createImageDataFromBytes(
  bytes: Uint8Array | Uint8ClampedArray,
  dims: CanvasDims,
): ImageData | null {
  if (bytes.length !== canvasBytes(dims)) {
    return null
  }

  // ImageData needs a Uint8ClampedArray specifically, and copying also detaches
  // us from the frame's backing buffer — which for a Node Buffer is pooled
  // memory that gets reused underneath us.
  return new ImageData(new Uint8ClampedArray(bytes), dims.width, dims.height)
}

// Base64 remains the encoding for the two paths that are NOT socket snapshots:
// the REST thumbnail endpoint (JSON) and playback's base canvas (text). Both are
// one-shot and off the hot path, so the +33% does not justify a second binary
// surface.
export function createImageDataFromBase64(
  data: string,
  dims: CanvasDims,
): ImageData | null {
  const binary = atob(data)
  const bytes = new Uint8ClampedArray(binary.length)

  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i)
  }

  return createImageDataFromBytes(bytes, dims)
}

// Crops or pads an RGBA buffer to new dimensions, anchored at the TOP-LEFT.
// Growing adds transparent pixels on the right and bottom; shrinking discards
// the pixels past the new edge. The kept region is copied byte-exact.
//
// Anchored crop/pad rather than resampling is deliberate (CLAUDE.md §16):
// resampling rewrites every pixel, so the event log and undo stacks would no
// longer describe the canvas. Crop/pad is lossless for the region that survives.
// Row-by-row because the source and destination strides differ once the widths
// do — a single `set` would misalign every row but the first.
export function resizePixels(
  src: Uint8ClampedArray,
  from: CanvasDims,
  to: CanvasDims,
): Uint8ClampedArray {
  const out = new Uint8ClampedArray(canvasBytes(to))
  const copyWidth = Math.min(from.width, to.width)
  const copyHeight = Math.min(from.height, to.height)

  for (let y = 0; y < copyHeight; y += 1) {
    const srcStart = y * from.width * 4
    const dstStart = y * to.width * 4
    out.set(src.subarray(srcStart, srcStart + copyWidth * 4), dstStart)
  }
  return out
}
//#endregion

//#region Canvas Methods
export function getCanvasState(
  canvas: HTMLCanvasElement,
  dims: CanvasDims,
): CanvasState | null {
  // Sizing the element to `dims` also decides the ImageData size below. Setting
  // canvas.width/height CLEARS the bitmap, so it is guarded to only fire on a
  // real change — which is exactly what a live resize wants: a genuine dimension
  // change drops the stale cache and rebuilds at the new size, while an ordinary
  // draw at an unchanged size is a no-op.
  if (canvas.width !== dims.width || canvas.height !== dims.height) {
    canvas.width = dims.width
    canvas.height = dims.height
    canvasStates.delete(canvas)
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
    imageData: ctx.getImageData(0, 0, dims.width, dims.height),
  }
  canvasStates.set(canvas, state)
  return state
}
export function updateCanvas(canvas: HTMLCanvasElement, dims: CanvasDims): void {
  const canvasState = getCanvasState(canvas, dims)
  if (canvasState === null) {
    return
  }

  canvasState.ctx.putImageData(canvasState.imageData, 0, 0)
}

// Returns raw canvas coordinates, which may be OUTSIDE the canvas when the
// pointer is. Callers must clip or clamp before touching pixels.
export function getPos(ev: PointerEvent, canvas: HTMLCanvasElement): Vec {
  const rect = canvas.getBoundingClientRect()
  // The element's own width/height ARE the canvas dimensions (getCanvasState
  // sizes it to the room's dims), so map through those rather than a constant —
  // otherwise a resized room would translate every pointer position wrongly.
  const scaleX = canvas.width / rect.width
  const scaleY = canvas.height / rect.height

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
export function clipSegmentToCanvas(
  a: Vec,
  b: Vec,
  dims: CanvasDims,
): [Vec, Vec] | null {
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
  const xMax = dims.width - 1
  const yMax = dims.height - 1

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

  const correctedX = clamp(x, 0, canvas.width - 1)
  const correctedY = clamp(y, 0, canvas.height - 1)

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

// Collapses a gesture's raw recording into the patch that undoes it: one entry
// per pixel, holding the colour it had before the gesture started and the colour
// it ended on, with untouched-in-net pixels dropped entirely.
//
// This is required, not an optimisation. withRecording appends one entry per
// WRITE, and a brush repaints the same pixels on every pointermove — so a stroke
// that covers the canvas records several times more entries than the canvas has
// pixels. Patch validation caps entries at width * height, so the undo for a big
// stroke failed that check and was rejected: undo lit up, did nothing, and said
// nothing. Coalescing keeps the recording bounded by the only thing that
// actually bounds it — how many distinct pixels the gesture touched.
//
// Dropping from-equals-to entries matters for the same reason it matters for a
// bucket fill that finds the colour already there: a pixel the gesture left
// exactly as it found it was never changed, so undoing it is a no-op that would
// otherwise be logged, broadcast and replayed for nothing.
export function coalesceRecording(entries: PatchEntry[]): PatchEntry[] {
  // Map keeps first-insertion order, so the result stays in first-touch order.
  const byPixel = new Map<number, PatchEntry>()
  for (const entry of entries) {
    const seen = byPixel.get(entry.idx)
    if (seen) {
      // Keep the ORIGINAL `from` — that is the colour undo has to restore.
      seen.to = entry.to
    } else {
      byPixel.set(entry.idx, { idx: entry.idx, from: entry.from, to: entry.to })
    }
  }

  const coalesced: PatchEntry[] = []
  for (const entry of byPixel.values()) {
    if (!colorsEqual(entry.from, entry.to)) {
      coalesced.push(entry)
    }
  }
  return coalesced
}
//#endregion

//#region Color Methods
export function getDirectColor(cp: ColorPalette, ev: PointerEvent): ColorType {
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

//#region Brush
// Visits every pixel of a filled disc of the given DIAMETER centred on (cx, cy),
// skipping anything outside the canvas. A pixel is inside when its distance from
// the centre is within the radius (size / 2): size 1 -> just the centre, size 3
// -> a 3x3 plus, and so on. Bounds are checked here because a disc near an edge
// spills past it even when its centre is in-bounds — unlike a 1px line, which
// the caller had already clipped.
//
// Shared by the line tools and the spray can so "how big is the brush" is
// defined in exactly one place.
export function forEachDiscPixel(
  cx: number,
  cy: number,
  size: number,
  dims: CanvasDims,
  visit: (vec: Vec) => void,
): void {
  if (size <= 1) {
    if (cx >= 0 && cy >= 0 && cx < dims.width && cy < dims.height) {
      visit([cx, cy])
    }
    return
  }

  const half = size / 2
  const reach = Math.ceil(half)
  const rSquared = half * half

  for (let dy = -reach; dy <= reach; dy += 1) {
    const y = cy + dy
    if (y < 0 || y >= dims.height) {
      continue
    }
    for (let dx = -reach; dx <= reach; dx += 1) {
      const x = cx + dx
      if (x < 0 || x >= dims.width) {
        continue
      }
      if (dx * dx + dy * dy <= rSquared) {
        visit([x, y])
      }
    }
  }
}
//#endregion
