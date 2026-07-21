//#region Imports
import { canvasBytes } from "../../constants/canvas"

import type { CanvasDims } from "../../constants/canvas"
import type { ColorType } from "../../types/primitive"
//#endregion

//#region Canvas Helpers
// The dimensions the shared tests exercise. Deliberately a fixed 120x120 and NOT
// tied to DEFAULT_CANVAS_DIMS: these tests hardcode coordinates and full-canvas
// pixel counts, and the pixel logic is dimension-agnostic, so pinning a small
// square keeps them stable no matter what a new room's default size becomes.
// Exported as the one obvious dims value to pass into the now-parameterised
// shared functions.
export const DIMS: CanvasDims = { width: 120, height: 120 }

// A bare RGBA buffer, exactly what RoomState.pixels is on the server. Every
// shared draw function accepts this directly, which is the whole reason the
// protocol is testable without a DOM.
export function makeCanvas(dims: CanvasDims = DIMS): Uint8ClampedArray {
  return new Uint8ClampedArray(canvasBytes(dims))
}

export function idxOf(x: number, y: number, dims: CanvasDims = DIMS): number {
  return (y * dims.width + x) * 4
}

export function getPixel(
  pixels: Uint8ClampedArray,
  x: number,
  y: number,
): ColorType {
  const i = idxOf(x, y)
  return { r: pixels[i], g: pixels[i + 1], b: pixels[i + 2], a: pixels[i + 3] }
}

export function setPixel(
  pixels: Uint8ClampedArray,
  x: number,
  y: number,
  color: ColorType,
): void {
  const i = idxOf(x, y)
  pixels[i] = color.r
  pixels[i + 1] = color.g
  pixels[i + 2] = color.b
  pixels[i + 3] = color.a
}

// Counts non-transparent pixels — a cheap way to assert "nothing else got
// painted" without comparing 57,600 bytes.
export function paintedCount(pixels: Uint8ClampedArray): number {
  let count = 0
  for (let i = 3; i < pixels.length; i += 4) {
    if (pixels[i] !== 0) {
      count += 1
    }
  }
  return count
}
//#endregion

//#region Fixtures
export const RED: ColorType = { r: 255, g: 0, b: 0, a: 255 }
export const BLUE: ColorType = { r: 0, g: 0, b: 255, a: 255 }
export const GREEN: ColorType = { r: 0, g: 255, b: 0, a: 255 }
export const TRANSPARENT: ColorType = { r: 0, g: 0, b: 0, a: 0 }

// BaseInstruction fields every wire instruction carries. Spread into fixtures
// so individual tests only state what they actually care about.
export const BASE = { instructionId: 1, sessionId: "test-session" }
//#endregion
