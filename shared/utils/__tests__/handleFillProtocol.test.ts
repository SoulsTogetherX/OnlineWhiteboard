import { describe, expect, it } from "vitest"

import { handleDrawFillInstruction } from "../handleFillProtocol"
import { handleDrawLineInstruction } from "../handleLineProtocol"
import { CANVAS_HEIGHT, CANVAS_WIDTH } from "../../constants/canvas"

import {
  BASE,
  BLUE,
  GREEN,
  RED,
  getPixel,
  makeCanvas,
  paintedCount,
  setPixel,
} from "./testHelpers"

import type { FillInstruction, LineInstruction } from "../../types/drawProtocol"

const fill = (pos: [number, number], color = RED): FillInstruction =>
  ({ type: "bucket", pos, color, ...BASE }) as FillInstruction

const TOTAL_PIXELS = CANVAS_WIDTH * CANVAS_HEIGHT

describe("handleDrawFillInstruction — flood fill", () => {
  it("floods an empty canvas entirely", () => {
    const pixels = makeCanvas()

    handleDrawFillInstruction(pixels, fill([0, 0]))

    expect(paintedCount(pixels)).toBe(TOTAL_PIXELS)
    expect(getPixel(pixels, CANVAS_WIDTH - 1, CANVAS_HEIGHT - 1)).toEqual(RED)
  })

  it("is a no-op when the target already holds the fill color", () => {
    const pixels = makeCanvas()
    handleDrawFillInstruction(pixels, fill([0, 0]))
    const before = Array.from(pixels)

    handleDrawFillInstruction(pixels, fill([10, 10]))

    expect(Array.from(pixels)).toEqual(before)
  })

  it("does not cross a barrier — a boxed region stays contained", () => {
    const pixels = makeCanvas()

    // Draw a closed 4-sided box with corners (2,2) and (8,8).
    const wall = (
      prevPos: [number, number],
      nextPos: [number, number],
    ): LineInstruction =>
      ({ type: "pencil", prevPos, nextPos, color: BLUE, ...BASE }) as LineInstruction
    handleDrawLineInstruction(pixels, wall([2, 2], [8, 2]))
    handleDrawLineInstruction(pixels, wall([8, 2], [8, 8]))
    handleDrawLineInstruction(pixels, wall([8, 8], [2, 8]))
    handleDrawLineInstruction(pixels, wall([2, 8], [2, 2]))

    // Fill the interior.
    handleDrawFillInstruction(pixels, fill([5, 5], RED))

    // Interior is red...
    expect(getPixel(pixels, 5, 5)).toEqual(RED)
    expect(getPixel(pixels, 3, 3)).toEqual(RED)
    // ...the wall is untouched...
    expect(getPixel(pixels, 2, 2)).toEqual(BLUE)
    // ...and nothing leaked outside.
    expect(getPixel(pixels, 0, 0)).toEqual({ r: 0, g: 0, b: 0, a: 0 })
    expect(getPixel(pixels, 10, 10)).toEqual({ r: 0, g: 0, b: 0, a: 0 })
  })

  it("fills only the 4-connected region, not diagonal neighbours", () => {
    const pixels = makeCanvas()
    // Two pixels touching only at a corner. Flood fill uses 4-way adjacency,
    // so filling one must not reach the other.
    setPixel(pixels, 0, 0, GREEN)
    setPixel(pixels, 1, 1, GREEN)

    handleDrawFillInstruction(pixels, fill([0, 0], RED))

    expect(getPixel(pixels, 0, 0)).toEqual(RED)
    expect(getPixel(pixels, 1, 1)).toEqual(GREEN)
  })

  it("replaces an existing region wholesale", () => {
    const pixels = makeCanvas()
    handleDrawFillInstruction(pixels, fill([0, 0], RED))

    handleDrawFillInstruction(pixels, fill([60, 60], BLUE))

    expect(getPixel(pixels, 0, 0)).toEqual(BLUE)
    expect(getPixel(pixels, CANVAS_WIDTH - 1, CANVAS_HEIGHT - 1)).toEqual(BLUE)
  })

  it("fills a region that touches the canvas edge without escaping the buffer", () => {
    const pixels = makeCanvas()
    // Vertical wall down column 1 — the region left of it is a 1px strip
    // pinned against the canvas edge.
    handleDrawLineInstruction(
      pixels,
      { type: "pencil", prevPos: [1, 0], nextPos: [1, CANVAS_HEIGHT - 1], color: BLUE, ...BASE } as LineInstruction,
    )

    handleDrawFillInstruction(pixels, fill([0, 0], RED))

    expect(getPixel(pixels, 0, 0)).toEqual(RED)
    expect(getPixel(pixels, 0, CANVAS_HEIGHT - 1)).toEqual(RED)
    // Did not bleed past the wall.
    expect(getPixel(pixels, 2, 0)).toEqual({ r: 0, g: 0, b: 0, a: 0 })
  })
})
