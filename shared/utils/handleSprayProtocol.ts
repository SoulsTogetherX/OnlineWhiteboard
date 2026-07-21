//#region Imports
import {
  clamp,
  getCanvasState,
  getDrawerMethod,
  getIdxFromVec,
  getLookAtMethod,
  getPosCorrected,
  updateCanvas,
  withRecording,
} from "./helperProtocolMethods"
import { mulberry32, randomSeed } from "./random"

import {
  DEFAULT_COLOR,
  DEFAULT_STROKE_SIZE,
  MAX_SPRAY_DENSITY,
  MAX_SPRAY_RADIUS,
} from "../constants/canvas"

import type { CanvasDims } from "../constants/canvas"
import type {
  BaseInstruction,
  PatchEntry,
  SprayAction,
  SprayInstruction,
} from "../types/drawProtocol"
import type { ColorType, Vec } from "../types/primitive"
//#endregion

//#region Derived params
// A wider brush sprays over a wider radius and lays down more pixels per puff.
// Density grows with area but is capped, so a big brush feels denser without a
// single puff ever painting an unbounded number of pixels.
export function sprayRadiusFor(size: number): number {
  return clamp(Math.round(size), 1, MAX_SPRAY_RADIUS)
}
export function sprayDensityFor(radius: number): number {
  return clamp(Math.round(radius * radius * 0.25), 1, MAX_SPRAY_DENSITY)
}
//#endregion

//#region Apply
// Scatters `density` pixels inside the disc of `radius` around `pos`, positioned
// by the seeded PRNG. Uniform-in-disc sampling: angle uniform, radius scaled by
// sqrt(random) so points don't clump at the centre. Deterministic in `seed`, so
// this produces byte-identical results wherever it runs.
function setPixelSpray(
  fields: { pos: Vec; radius: number; density: number; seed: number },
  color: ColorType,
  setPixel: (idx: number, color: ColorType) => void,
  dims: CanvasDims,
): void {
  const rand = mulberry32(fields.seed)
  const [cx, cy] = fields.pos

  for (let i = 0; i < fields.density; i += 1) {
    const angle = rand() * Math.PI * 2
    const dist = Math.sqrt(rand()) * fields.radius
    const x = Math.round(cx + Math.cos(angle) * dist)
    const y = Math.round(cy + Math.sin(angle) * dist)
    if (x >= 0 && y >= 0 && x < dims.width && y < dims.height) {
      setPixel(getIdxFromVec([x, y], dims), color)
    }
  }
}

function createInstruction(
  base: BaseInstruction,
  fields: { pos: Vec; radius: number; density: number; seed: number },
): SprayInstruction {
  return { ...base, type: "spray", ...fields }
}

// One puff at the current pointer position. Called on start and on every motion
// sample, each with a fresh seed so a held spray keeps building up texture.
function handlePuff(
  canvas: HTMLCanvasElement,
  base: BaseInstruction,
  ev: PointerEvent,
  dims: CanvasDims,
  record?: PatchEntry[],
): SprayInstruction | null {
  // Clamp the centre to the canvas — spraying with the pointer just past the
  // edge should still stipple the nearby border, not draw nothing.
  const [pos] = getPosCorrected(ev, canvas)
  const radius = sprayRadiusFor(base.size ?? DEFAULT_STROKE_SIZE)
  // A client-set density (the Spray panel's slider) overrides the radius-derived
  // default, clamped to the same abuse cap the server validates against.
  const density =
    base.density !== undefined
      ? clamp(Math.round(base.density), 1, MAX_SPRAY_DENSITY)
      : sprayDensityFor(radius)
  const seed = randomSeed()

  const canvasState = getCanvasState(canvas, dims)
  if (canvasState === null) {
    return null
  }

  let drawer = getDrawerMethod("spray", canvasState.imageData)
  if (record) {
    const getColor = getLookAtMethod("spray", canvasState.imageData)
    drawer = withRecording(getColor, drawer, record)
  }

  const fields = { pos, radius, density, seed }
  setPixelSpray(fields, base.color ?? DEFAULT_COLOR, drawer, dims)
  updateCanvas(canvas, dims)
  return createInstruction(base, fields)
}
//#endregion

//#region Handle Methods
export function handleDrawSprayStart(
  canvas: HTMLCanvasElement,
  base: BaseInstruction,
  _da: SprayAction,
  ev: PointerEvent,
  dims: CanvasDims,
  record?: PatchEntry[],
): SprayInstruction | null {
  return handlePuff(canvas, base, ev, dims, record)
}
export function handleDrawSprayMotion(
  canvas: HTMLCanvasElement,
  base: BaseInstruction,
  _da: SprayAction,
  ev: PointerEvent,
  dims: CanvasDims,
  record?: PatchEntry[],
): SprayInstruction | null {
  return handlePuff(canvas, base, ev, dims, record)
}
export function handleDrawSprayLeave(
  canvas: HTMLCanvasElement,
  base: BaseInstruction,
  _da: SprayAction,
  ev: PointerEvent,
  dims: CanvasDims,
  record?: PatchEntry[],
): SprayInstruction | null {
  return handlePuff(canvas, base, ev, dims, record)
}
export function handleDrawSprayFinish(
  _canvas: HTMLCanvasElement,
  _base: BaseInstruction,
  _da: SprayAction,
  _ev: PointerEvent,
): SprayInstruction | null {
  return null
}
export function handleDrawSprayInstruction(
  pixels: ImageData | Uint8ClampedArray<ArrayBufferLike>,
  inst: SprayInstruction,
  dims: CanvasDims,
): void {
  const drawer = getDrawerMethod("spray", pixels)
  setPixelSpray(inst, inst.color ?? DEFAULT_COLOR, drawer, dims)
}
//#endregion
