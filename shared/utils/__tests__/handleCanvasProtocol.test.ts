import { describe, expect, it } from "vitest"

import { applyDrawInstructionToCanvas } from "../handleCanvasProtocol"
import { getIdxFromVec } from "../helperProtocallMethods"
import { CANVAS_BYTES, CANVAS_HEIGHT, CANVAS_WIDTH } from "../../constants/canvas"

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

import type { DrawInstruction, PatchInstruction } from "../../types/drawProtocol"

describe("applyDrawInstructionToCanvas — dispatch", () => {
  it("applies a pencil instruction and hands it straight back", () => {
    const pixels = makeCanvas()
    const inst = {
      type: "pencil",
      prevPos: [0, 0],
      nextPos: [3, 0],
      color: RED,
      ...BASE,
    } as DrawInstruction

    const applied = applyDrawInstructionToCanvas(pixels, inst)

    expect(applied).toBe(inst)
    expect(getPixel(pixels, 3, 0)).toEqual(RED)
  })

  it("applies a bucket instruction and hands it straight back", () => {
    const pixels = makeCanvas()
    const inst = { type: "bucket", pos: [0, 0], color: RED, ...BASE } as DrawInstruction

    const applied = applyDrawInstructionToCanvas(pixels, inst)

    expect(applied).toBe(inst)
    expect(paintedCount(pixels)).toBe(CANVAS_WIDTH * CANVAS_HEIGHT)
  })

  it("returns a patch narrowed to only the entries that applied", () => {
    const pixels = makeCanvas()
    setPixel(pixels, 0, 0, RED)
    setPixel(pixels, 1, 0, GREEN)

    const inst: PatchInstruction = {
      type: "patch",
      entries: [
        { idx: getIdxFromVec([0, 0]), from: RED, to: BLUE },
        { idx: getIdxFromVec([1, 0]), from: RED, to: BLUE },
      ],
      ...BASE,
    }

    const applied = applyDrawInstructionToCanvas(pixels, inst) as PatchInstruction

    expect(applied).not.toBeNull()
    expect(applied.entries).toHaveLength(1)
    // The original is not mutated — the server broadcasts the narrowed copy.
    expect(inst.entries).toHaveLength(2)
  })

  it("returns null when a patch applies nothing, so nothing is broadcast", () => {
    const pixels = makeCanvas()
    setPixel(pixels, 0, 0, GREEN)

    const applied = applyDrawInstructionToCanvas(pixels, {
      type: "patch",
      entries: [{ idx: getIdxFromVec([0, 0]), from: RED, to: BLUE }],
      ...BASE,
    })

    expect(applied).toBeNull()
  })
})

describe("applyDrawInstructionToCanvas — hostile input", () => {
  // The server applies whatever arrives on the socket. parseMessage does
  // JSON.parse + an `as` cast, which is a compile-time lie: nothing validates
  // these values at runtime. These tests pin down that malformed instructions
  // are rejected rather than hanging or corrupting the room.

  it("rejects a line with absurd coordinates instead of looping forever", () => {
    const pixels = makeCanvas()
    const started = Date.now()

    const applied = applyDrawInstructionToCanvas(pixels, {
      type: "pencil",
      prevPos: [0, 0],
      nextPos: [1_000_000_000, 1_000_000_000],
      color: RED,
      ...BASE,
    } as DrawInstruction)

    // Bresenham is a `while (true)` loop that steps one pixel at a time. With
    // no bounds check this runs a billion iterations and pins a core — one
    // socket message DoSing the whole server for every room.
    expect(Date.now() - started).toBeLessThan(250)
    expect(applied).toBeNull()
    expect(paintedCount(pixels)).toBe(0)
  }, 5_000)

  it("rejects negative coordinates", () => {
    const pixels = makeCanvas()

    const applied = applyDrawInstructionToCanvas(pixels, {
      type: "pencil",
      prevPos: [-5, -5],
      nextPos: [2, 2],
      color: RED,
      ...BASE,
    } as DrawInstruction)

    expect(applied).toBeNull()
    expect(paintedCount(pixels)).toBe(0)
  })

  it("rejects non-integer and non-finite coordinates", () => {
    const pixels = makeCanvas()

    for (const bad of [[1.5, 2], [NaN, 0], [Infinity, 0]]) {
      const applied = applyDrawInstructionToCanvas(pixels, {
        type: "pencil",
        prevPos: [0, 0],
        nextPos: bad,
        color: RED,
        ...BASE,
      } as DrawInstruction)

      expect(applied).toBeNull()
    }
    expect(paintedCount(pixels)).toBe(0)
  })

  it("rejects a line missing its positions entirely", () => {
    const pixels = makeCanvas()

    const applied = applyDrawInstructionToCanvas(pixels, {
      type: "pencil",
      color: RED,
      ...BASE,
    } as unknown as DrawInstruction)

    expect(applied).toBeNull()
  })

  it("rejects a bucket outside the canvas", () => {
    const pixels = makeCanvas()

    const applied = applyDrawInstructionToCanvas(pixels, {
      type: "bucket",
      pos: [CANVAS_WIDTH, 0],
      color: RED,
      ...BASE,
    } as DrawInstruction)

    expect(applied).toBeNull()
    expect(paintedCount(pixels)).toBe(0)
  })

  it("rejects patch entries with an out-of-range or misaligned index", () => {
    const pixels = makeCanvas()

    for (const idx of [-4, CANVAS_BYTES, CANVAS_BYTES + 4, 3]) {
      const applied = applyDrawInstructionToCanvas(pixels, {
        type: "patch",
        entries: [{ idx, from: { r: 0, g: 0, b: 0, a: 0 }, to: RED }],
        ...BASE,
      })

      expect(applied).toBeNull()
    }
    expect(paintedCount(pixels)).toBe(0)
  })

  it("rejects an instruction with a malformed color", () => {
    const pixels = makeCanvas()

    const applied = applyDrawInstructionToCanvas(pixels, {
      type: "pencil",
      prevPos: [0, 0],
      nextPos: [1, 1],
      color: { r: 999, g: -1, b: NaN, a: 255 },
      ...BASE,
    } as DrawInstruction)

    expect(applied).toBeNull()
    expect(paintedCount(pixels)).toBe(0)
  })

  it("rejects a stroke size that is out of range or non-integer", () => {
    const pixels = makeCanvas()

    for (const size of [0, -1, 33, 1.5, NaN, Infinity]) {
      const applied = applyDrawInstructionToCanvas(pixels, {
        type: "pencil",
        prevPos: [0, 0],
        nextPos: [1, 1],
        color: RED,
        size,
        ...BASE,
      } as unknown as DrawInstruction)

      expect(applied).toBeNull()
    }
    expect(paintedCount(pixels)).toBe(0)
  })

  it("accepts a valid in-range stroke size", () => {
    const pixels = makeCanvas()

    const applied = applyDrawInstructionToCanvas(pixels, {
      type: "pencil",
      prevPos: [10, 10],
      nextPos: [10, 10],
      color: RED,
      size: 5,
      ...BASE,
    } as DrawInstruction)

    expect(applied).not.toBeNull()
    expect(paintedCount(pixels)).toBeGreaterThan(1)
  })

  it("still accepts a legitimate edge-of-canvas instruction", () => {
    // Guard against over-zealous validation rejecting valid input.
    const pixels = makeCanvas()

    const applied = applyDrawInstructionToCanvas(pixels, {
      type: "pencil",
      prevPos: [0, 0],
      nextPos: [CANVAS_WIDTH - 1, CANVAS_HEIGHT - 1],
      color: RED,
      ...BASE,
    } as DrawInstruction)

    expect(applied).not.toBeNull()
    expect(getPixel(pixels, CANVAS_WIDTH - 1, CANVAS_HEIGHT - 1)).toEqual(RED)
  })
})
