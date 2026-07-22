//#region Why this is different from every other tool
// Blur is the first instruction whose OUTPUT depends on the canvas it lands on.
// Every other tool carries everything it needs: a pencil knows its colour, a
// spray knows its seed. A blur knows only where and how much — what it actually
// paints is derived from the pixels already there.
//
// That has two consequences the rest of the protocol does not have to think
// about:
//
//   1. Every number must be on the wire. The kernel size, the mix and the alpha
//      rule all change the result, so if a client read them from its own sliders
//      instead of from the instruction, two clients would compute different
//      pixels from the same event and drift apart permanently. Same reasoning as
//      the spray's `seed`, for exactly the same reason.
//
//   2. It is order-dependent. Blurring twice is not blurring once, so a client
//      that applied two overlapping blurs in the other order would end up with a
//      different canvas. That is safe here only because nobody ever chooses an
//      order: the server assigns one and everyone replays that log.
//
// The sampling reads from a SNAPSHOT taken before any writing, not from the
// canvas as it is being modified. Sampling live would make each pixel's result
// depend on how many of its neighbours had already been written, which is a
// smear that drags in the iteration's direction rather than a blur — visibly
// lopsided, and dependent on a traversal order no part of the protocol promises.
//#endregion

//#region Imports
import {
  clamp,
  forEachDiscPixel,
  getCanvasState,
  getDrawerMethod,
  getIdxFromVec,
  getLookAtMethod,
  getPosCorrected,
  updateCanvas,
  withChangeCount,
  withRecording,
} from "./helperProtocolMethods"

import {
  DEFAULT_BLUR_BLEND,
  DEFAULT_BLUR_OPACITY,
  DEFAULT_STROKE_SIZE,
  MAX_BLUR_BLEND,
  MAX_BLUR_OPACITY,
  MAX_SPRAY_RADIUS,
} from "../constants/canvas"

import type { CanvasDims } from "../constants/canvas"
import type {
  BaseInstruction,
  BlurAction,
  BlurInstruction,
  PatchEntry,
} from "../types/drawProtocol"
import type { ColorType, Vec } from "../types/primitive"
//#endregion

//#region Geometry
// The brush radius, derived from the shared stroke size the same way the spray
// derives its own, so "size 8" means a comparable footprint whichever of the two
// you are holding.
export function blurRadiusFor(size: number): number {
  return clamp(Math.round(size), 1, MAX_SPRAY_RADIUS)
}
//#endregion

//#region Helper Method
// Averages the neighbourhood of one pixel from `source`, clamping at the canvas
// edges so an edge pixel averages the neighbours it actually has rather than
// pulling in transparent black from outside and darkening the border.
function averageAt(
  source: Uint8ClampedArray,
  x: number,
  y: number,
  blend: number,
  dims: CanvasDims,
): { r: number | null; g: number | null; b: number | null; a: number } {
  // Colour is averaged WEIGHTED BY ALPHA; alpha is averaged plainly.
  //
  // A transparent pixel has no colour to contribute — it is "nothing", not
  // "black" — but its RGB bytes are usually 0, and a plain average happily reads
  // those zeros as black. Blurring the edge of a drawing against empty canvas
  // therefore dragged a dark halo inwards: the classic transparency-fringe bug.
  //
  // Weighting by alpha makes a transparent neighbour contribute nothing to the
  // colour while still contributing its transparency to the alpha. The effect at
  // an edge is exactly what you want: the opaque side's colour is carried into
  // the transparent side (there is no other colour in the sum), and what varies
  // across the boundary is the alpha alone.
  let weightedR = 0
  let weightedG = 0
  let weightedB = 0
  let totalAlpha = 0
  let alphaSum = 0
  let n = 0

  const minX = Math.max(0, x - blend)
  const maxX = Math.min(dims.width - 1, x + blend)
  const minY = Math.max(0, y - blend)
  const maxY = Math.min(dims.height - 1, y + blend)

  for (let sy = minY; sy <= maxY; sy += 1) {
    for (let sx = minX; sx <= maxX; sx += 1) {
      const idx = (sy * dims.width + sx) * 4
      const alpha = source[idx + 3]
      weightedR += source[idx] * alpha
      weightedG += source[idx + 1] * alpha
      weightedB += source[idx + 2] * alpha
      totalAlpha += alpha
      alphaSum += alpha
      n += 1
    }
  }

  // A neighbourhood that is entirely transparent has no colour to offer, so the
  // pixel keeps whatever colour it already had. Returning zeros here would
  // reintroduce the same black-bleed by another route.
  if (totalAlpha === 0) {
    return { r: null, g: null, b: null, a: 0 }
  }

  return {
    r: weightedR / totalAlpha,
    g: weightedG / totalAlpha,
    b: weightedB / totalAlpha,
    a: alphaSum / n,
  }
}

// Blurs the disc at `pos`. Every write goes through `setPixel`, so the caller
// decides whether it also records undo entries or counts changes — the same
// wrapper trick the other tools use.
function setPixelBlur(
  fields: {
    pos: Vec
    radius: number
    blend: number
    opacity: number
    lockAlpha: boolean
  },
  source: Uint8ClampedArray,
  getPixel: (idx: number) => ColorType,
  setPixel: (idx: number, color: ColorType) => void,
  dims: CanvasDims,
): void {
  // 0..1. The pixel keeps (1 - mix) of itself, which is what lets a low opacity
  // build up over several passes instead of resolving in one.
  const mix = clamp(fields.opacity, 1, MAX_BLUR_OPACITY) / 100
  const blend = clamp(Math.round(fields.blend), 1, MAX_BLUR_BLEND)

  forEachDiscPixel(
    fields.pos[0],
    fields.pos[1],
    // forEachDiscPixel takes a DIAMETER; radius is the honest unit for a blur.
    fields.radius * 2,
    dims,
    (vec) => {
      const idx = getIdxFromVec(vec, dims)
      const current = getPixel(idx)
      const avg = averageAt(source, vec[0], vec[1], blend, dims)

      // Math.round, not truncation: rounding is symmetric, so a flat region
      // averages back to itself and repeated passes over unchanged pixels stay
      // no-ops instead of drifting one level darker each time.
      //
      // A null channel means the neighbourhood had no colour at all (everything
      // around it is fully transparent), so there is nothing to move towards and
      // the pixel keeps what it has.
      const towards = (channel: number | null, from: number): number =>
        channel === null ? from : Math.round(from + (channel - from) * mix)

      setPixel(idx, {
        r: towards(avg.r, current.r),
        g: towards(avg.g, current.g),
        b: towards(avg.b, current.b),
        // Locking alpha keeps the drawing's SHAPE and softens only the colour
        // inside it. Without it, blurring near an edge averages in the
        // transparency outside and the stroke erodes as you smudge it.
        a: fields.lockAlpha
          ? current.a
          : Math.round(current.a + (avg.a - current.a) * mix),
      })
    },
  )
}

function createInstruction(
  base: BaseInstruction,
  da: BlurAction,
  pos: Vec,
): BlurInstruction {
  return {
    ...base,
    type: "blur",
    pos,
    radius: blurRadiusFor(base.size ?? DEFAULT_STROKE_SIZE),
    blend: da.blend ?? DEFAULT_BLUR_BLEND,
    opacity: da.opacity ?? DEFAULT_BLUR_OPACITY,
    lockAlpha: da.lockAlpha ?? false,
    // A blur has no colour of its own; it is made of what is already there.
    // Leaving the field off keeps that true on the wire as well as in the code.
    color: undefined,
  }
}
//#endregion

//#region Gesture Handlers
// A local blur, applied optimistically and recorded for undo. Mirrors the spray:
// one instruction per pointer sample, each independently replayable.
function handleDraw(
  canvas: HTMLCanvasElement,
  base: BaseInstruction,
  da: BlurAction,
  ev: PointerEvent,
  dims: CanvasDims,
  record?: PatchEntry[],
): BlurInstruction | null {
  // The boolean is "was it clamped" — i.e. the pointer was outside the canvas.
  // The spray ignores it and blurs at the clamped edge position; doing the same
  // here keeps a smudge that runs off the edge continuous instead of stopping
  // dead at the boundary.
  const [pos] = getPosCorrected(ev, canvas)

  const state = getCanvasState(canvas, dims)
  if (!state) {
    return null
  }

  const instruction = createInstruction(base, da, pos)
  const pixels = state.imageData.data
  // The snapshot the averages are read from — see the note at the top.
  const source = new Uint8ClampedArray(pixels)

  const getPixel = getLookAtMethod("blur", state.imageData)
  let setPixel = getDrawerMethod("blur", state.imageData)
  if (record) {
    setPixel = withRecording(getPixel, setPixel, record)
  }

  setPixelBlur(instruction, source, getPixel, setPixel, dims)
  updateCanvas(canvas, dims)
  return instruction
}

export function handleDrawBlurStart(
  canvas: HTMLCanvasElement,
  base: BaseInstruction,
  da: BlurAction,
  ev: PointerEvent,
  dims: CanvasDims,
  record?: PatchEntry[],
): BlurInstruction | null {
  return handleDraw(canvas, base, da, ev, dims, record)
}

export function handleDrawBlurMotion(
  canvas: HTMLCanvasElement,
  base: BaseInstruction,
  da: BlurAction,
  ev: PointerEvent,
  dims: CanvasDims,
  record?: PatchEntry[],
): BlurInstruction | null {
  return handleDraw(canvas, base, da, ev, dims, record)
}

// Leaving the canvas and lifting the pointer both end the gesture without
// emitting anything: every puff was already sent as it happened, exactly as the
// spray does.
export function handleDrawBlurLeave(
  _canvas: HTMLCanvasElement,
  _base: BaseInstruction,
  _da: BlurAction,
  _ev: PointerEvent,
): BlurInstruction | null {
  return null
}

export function handleDrawBlurFinish(
  _canvas: HTMLCanvasElement,
  _base: BaseInstruction,
  _da: BlurAction,
  _ev: PointerEvent,
): BlurInstruction | null {
  return null
}
//#endregion

//#region Instruction Application
// Returns how many pixels actually CHANGED, so a blur over an already-flat area
// is reported as the no-op it is and stays out of the timeline.
export function handleDrawBlurInstruction(
  pixels: ImageData | Uint8ClampedArray<ArrayBufferLike>,
  inst: BlurInstruction,
  dims: CanvasDims,
): number {
  const buffer = pixels instanceof Uint8ClampedArray ? pixels : pixels.data
  const source = new Uint8ClampedArray(buffer)

  const counter = { changed: 0 }
  const getPixel = getLookAtMethod("blur", pixels)
  const setPixel = withChangeCount(
    getPixel,
    getDrawerMethod("blur", pixels),
    counter,
  )

  setPixelBlur(inst, source, getPixel, setPixel, dims)
  return counter.changed
}
//#endregion
