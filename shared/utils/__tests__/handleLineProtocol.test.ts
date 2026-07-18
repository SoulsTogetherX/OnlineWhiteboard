import { describe, expect, it } from "vitest"

import { handleDrawLineInstruction } from "../handleLineProtocol"
import { CANVAS_HEIGHT, CANVAS_WIDTH } from "../../constants/canvas"

import { BASE, RED, getPixel, makeCanvas, paintedCount } from "./testHelpers"

import type { LineInstruction } from "../../types/drawProtocol"

const line = (
  prevPos: [number, number],
  nextPos: [number, number],
  overrides: Partial<LineInstruction> = {},
): LineInstruction =>
  ({
    type: "pencil",
    prevPos,
    nextPos,
    color: RED,
    ...BASE,
    ...overrides,
  }) as LineInstruction

describe("handleDrawLineInstruction — Bresenham", () => {
  it("paints a single pixel when start and end are the same", () => {
    const pixels = makeCanvas()

    handleDrawLineInstruction(pixels, line([5, 5], [5, 5]))

    expect(getPixel(pixels, 5, 5)).toEqual(RED)
    expect(paintedCount(pixels)).toBe(1)
  })

  it("size 1 (or absent) is unchanged single-pixel behaviour", () => {
    const pixels = makeCanvas()

    handleDrawLineInstruction(pixels, line([5, 5], [5, 5], { size: 1 }))

    expect(paintedCount(pixels)).toBe(1)
  })

  it("paints a horizontal run inclusive of both endpoints", () => {
    const pixels = makeCanvas()

    handleDrawLineInstruction(pixels, line([2, 3], [6, 3]))

    for (let x = 2; x <= 6; x += 1) {
      expect(getPixel(pixels, x, 3)).toEqual(RED)
    }
    expect(paintedCount(pixels)).toBe(5)
  })

  it("paints a vertical run inclusive of both endpoints", () => {
    const pixels = makeCanvas()

    handleDrawLineInstruction(pixels, line([4, 1], [4, 5]))

    for (let y = 1; y <= 5; y += 1) {
      expect(getPixel(pixels, 4, y)).toEqual(RED)
    }
    expect(paintedCount(pixels)).toBe(5)
  })

  it("paints a clean 45-degree diagonal", () => {
    const pixels = makeCanvas()

    handleDrawLineInstruction(pixels, line([0, 0], [4, 4]))

    for (let i = 0; i <= 4; i += 1) {
      expect(getPixel(pixels, i, i)).toEqual(RED)
    }
    expect(paintedCount(pixels)).toBe(5)
  })

  it("paints max(dx, dy) + 1 pixels — the Bresenham step invariant", () => {
    const pixels = makeCanvas()

    handleDrawLineInstruction(pixels, line([1, 2], [9, 7])) // dx=8, dy=5

    expect(paintedCount(pixels)).toBe(9)
  })

  it("reversing a line paints the same count and hits both endpoints", () => {
    // NOTE: deliberately NOT asserting pixel-for-pixel equality. Integer
    // Bresenham breaks ties by direction, so A->B and B->A can differ by a
    // pixel at a tie (verified: exactly 1 of 9 differs for this line). That is
    // a property of the algorithm, not a bug, and it cannot desync anyone —
    // the server and every client apply the *same* instruction with the same
    // prevPos->nextPos direction.
    const forward = makeCanvas()
    const backward = makeCanvas()

    handleDrawLineInstruction(forward, line([1, 2], [9, 7]))
    handleDrawLineInstruction(backward, line([9, 7], [1, 2]))

    expect(paintedCount(backward)).toBe(paintedCount(forward))
    for (const canvas of [forward, backward]) {
      expect(getPixel(canvas, 1, 2)).toEqual(RED)
      expect(getPixel(canvas, 9, 7)).toEqual(RED)
    }
  })

  it("paints every pixel of a shallow line exactly once per column", () => {
    const pixels = makeCanvas()

    handleDrawLineInstruction(pixels, line([0, 0], [10, 2]))

    // A shallow line advances x every step, so it must touch 11 columns.
    expect(paintedCount(pixels)).toBe(11)
  })

  it("erases by writing fully transparent pixels", () => {
    const pixels = makeCanvas()
    handleDrawLineInstruction(pixels, line([0, 0], [5, 0]))
    expect(paintedCount(pixels)).toBe(6)

    handleDrawLineInstruction(
      pixels,
      line([0, 0], [5, 0], { type: "eraser", color: { r: 0, g: 0, b: 0, a: 0 } }),
    )

    expect(paintedCount(pixels)).toBe(0)
  })

  it("stamps a filled disc for a wide brush on a single dot", () => {
    const pixels = makeCanvas()

    // size 3 -> a 3x3 block (radius 1.5) centred on the point.
    handleDrawLineInstruction(pixels, line([10, 10], [10, 10], { size: 3 }))

    expect(paintedCount(pixels)).toBe(9)
    for (let y = 9; y <= 11; y += 1) {
      for (let x = 9; x <= 11; x += 1) {
        expect(getPixel(pixels, x, y)).toEqual(RED)
      }
    }
  })

  it("clips a wide brush at the canvas edge", () => {
    const pixels = makeCanvas()

    // A size-3 dot at the corner: only the in-bounds quadrant is painted.
    handleDrawLineInstruction(pixels, line([0, 0], [0, 0], { size: 3 }))

    expect(paintedCount(pixels)).toBe(4)
    expect(getPixel(pixels, 0, 0)).toEqual(RED)
    expect(getPixel(pixels, 1, 1)).toEqual(RED)
  })

  it("a wide horizontal stroke paints a band, deduped (no double-count)", () => {
    const pixels = makeCanvas()

    // size 3 over a 5-long horizontal run -> a 3-tall band. Dedup means the
    // count is the union of the discs, not 5 discs x 9 pixels.
    handleDrawLineInstruction(pixels, line([10, 20], [14, 20], { size: 3 }))

    // Band spans x 9..15 (each end's disc reaches one past), y 19..21.
    expect(getPixel(pixels, 9, 20)).toEqual(RED)
    expect(getPixel(pixels, 15, 20)).toEqual(RED)
    expect(getPixel(pixels, 12, 19)).toEqual(RED)
    expect(getPixel(pixels, 12, 21)).toEqual(RED)
    // 7 columns x 3 rows = 21 in the core, minus nothing (rectangle) = 21.
    expect(paintedCount(pixels)).toBe(21)
  })

  it("draws to the far corner of the canvas", () => {
    const pixels = makeCanvas()

    handleDrawLineInstruction(
      pixels,
      line([CANVAS_WIDTH - 1, CANVAS_HEIGHT - 1], [CANVAS_WIDTH - 1, CANVAS_HEIGHT - 1]),
    )

    expect(getPixel(pixels, CANVAS_WIDTH - 1, CANVAS_HEIGHT - 1)).toEqual(RED)
  })
})
