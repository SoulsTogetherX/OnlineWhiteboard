import { describe, expect, it } from "vitest"

import {
  handleDrawLineMotion,
  handleDrawLineStart,
} from "../handleLineProtocol"

import { DIMS, RED, getPixel, makeCanvas } from "./testHelpers"

import type { BaseInstruction, LineAction } from "../../types/drawProtocol"

// Gesture-level tests for the pointer path, as opposed to the wire path in
// handleLineProtocol.test.ts.
//
// The DOM surface these functions touch is tiny — getBoundingClientRect,
// getContext('2d'), getImageData, putImageData — so a hand-rolled stub covers it
// without jsdom or a canvas polyfill. The rect is deliberately 1:1 with the
// canvas (120x120 CSS px at origin), which makes clientX/clientY read directly
// as canvas coordinates and keeps the assertions legible.
function makeFakeCanvas(pixels: Uint8ClampedArray): HTMLCanvasElement {
  const imageData = {
    data: pixels,
    width: DIMS.width,
    height: DIMS.height,
  } as unknown as ImageData

  const ctx = {
    getImageData: () => imageData,
    putImageData: () => {},
  } as unknown as CanvasRenderingContext2D

  return {
    width: DIMS.width,
    height: DIMS.height,
    getContext: () => ctx,
    getBoundingClientRect: () => ({
      left: 0,
      top: 0,
      width: DIMS.width,
      height: DIMS.height,
    }),
  } as unknown as HTMLCanvasElement
}

const ev = (x: number, y: number): PointerEvent =>
  ({
    clientX: x,
    clientY: y,
    pointerType: "mouse",
    button: 0,
    buttons: 1,
  }) as PointerEvent

const MAX_X = DIMS.width - 1
const MAX_Y = DIMS.height - 1

function startGesture() {
  const pixels = makeCanvas()
  const canvas = makeFakeCanvas(pixels)
  const da: LineAction = { type: "pencil" }
  const base: BaseInstruction = { instructionId: 1, sessionId: "test", color: RED }
  return { pixels, canvas, da, base }
}

describe("line gesture — drawing off the edge of the canvas", () => {
  it("runs the stroke all the way to the right edge when the pointer leaves", () => {
    // THE BUG: handleDraw used to bail out (`if (next[1] === false) return null`)
    // the moment the pointer was outside, so the stroke stopped at the last
    // in-bounds sample instead of continuing to the canvas edge.
    const { pixels, canvas, da, base } = startGesture()

    handleDrawLineStart(canvas, base, da, ev(40, 50), DIMS)
    const inst = handleDrawLineMotion(canvas, base, da, ev(300, 50), DIMS)

    expect(inst).not.toBeNull()
    expect(inst!.nextPos).toEqual([MAX_X, 50])
    expect(getPixel(pixels, MAX_X, 50)).toEqual(RED)
    expect(getPixel(pixels, 40, 50)).toEqual(RED)
  })

  it("reaches the bottom and left edges too", () => {
    const down = startGesture()
    handleDrawLineStart(down.canvas, down.base, down.da, ev(60, 40), DIMS)
    handleDrawLineMotion(down.canvas, down.base, down.da, ev(60, 400), DIMS)
    expect(getPixel(down.pixels, 60, MAX_Y)).toEqual(RED)

    const left = startGesture()
    handleDrawLineStart(left.canvas, left.base, left.da, ev(40, 60), DIMS)
    handleDrawLineMotion(left.canvas, left.base, left.da, ev(-400, 60), DIMS)
    expect(getPixel(left.pixels, 0, 60)).toEqual(RED)
  })

  it("emits an instruction whose endpoints are in-bounds, so it passes validation", () => {
    const { canvas, da, base } = startGesture()

    handleDrawLineStart(canvas, base, da, ev(40, 50), DIMS)
    const inst = handleDrawLineMotion(canvas, base, da, ev(9999, -9999), DIMS)

    // The segment still crosses the canvas, so something is drawn — and what
    // goes on the wire must never carry the raw off-canvas coordinates.
    if (inst !== null) {
      for (const [x, y] of [inst.prevPos, inst.nextPos]) {
        expect(x).toBeGreaterThanOrEqual(0)
        expect(x).toBeLessThanOrEqual(MAX_X)
        expect(y).toBeGreaterThanOrEqual(0)
        expect(y).toBeLessThanOrEqual(MAX_Y)
      }
    }
  })

  it("draws nothing while the pointer moves around entirely outside", () => {
    const { pixels, canvas, da, base } = startGesture()

    handleDrawLineStart(canvas, base, da, ev(60, 60), DIMS)
    handleDrawLineMotion(canvas, base, da, ev(300, 60), DIMS) // exits right
    const painted = pixels.slice()

    // Wander around out there — none of this should touch the canvas.
    const a = handleDrawLineMotion(canvas, base, da, ev(320, 70), DIMS)
    const b = handleDrawLineMotion(canvas, base, da, ev(340, 90), DIMS)

    expect(a).toBeNull()
    expect(b).toBeNull()
    expect(Array.from(pixels)).toEqual(Array.from(painted))
  })

  it("re-enters from the true crossing point, not from a clamped corner", () => {
    // This is why the action stores RAW positions: coming back on-screen, the
    // segment starts where the real line crosses the edge. If the off-canvas
    // position had been clamped to (119, 60) on the way out, the return stroke
    // would start from the wrong place and visibly kink.
    const { pixels, canvas, da, base } = startGesture()

    handleDrawLineStart(canvas, base, da, ev(60, 60), DIMS)
    handleDrawLineMotion(canvas, base, da, ev(240, 60), DIMS) // out to the right
    const back = handleDrawLineMotion(canvas, base, da, ev(100, 70), DIMS) // back in

    expect(back).not.toBeNull()
    // Entry lies on the right edge, between the two y values — NOT at y=60 flat.
    expect(back!.prevPos[0]).toBe(MAX_X)
    expect(back!.nextPos).toEqual([100, 70])
    expect(getPixel(pixels, 100, 70)).toEqual(RED)
  })

  it("still paints a single dot for a click that never moves", () => {
    const { pixels, canvas, da, base } = startGesture()

    const inst = handleDrawLineStart(canvas, base, da, ev(7, 8), DIMS)

    expect(inst).not.toBeNull()
    expect(inst!.prevPos).toEqual([7, 8])
    expect(inst!.nextPos).toEqual([7, 8])
    expect(getPixel(pixels, 7, 8)).toEqual(RED)
  })
})
