//#region Imports
import { CANVAS_BYTES, CANVAS_WIDTH } from "../../constants/canvas"

import type { ColorType } from "../../types/primitive"
//#endregion

//#region Canvas Helpers
// A bare RGBA buffer, exactly what RoomState.pixels is on the server. Every
// shared draw function accepts this directly, which is the whole reason the
// protocol is testable without a DOM.
export function makeCanvas(): Uint8ClampedArray {
  return new Uint8ClampedArray(CANVAS_BYTES)
}

export function idxOf(x: number, y: number): number {
  return (y * CANVAS_WIDTH + x) << 2
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
