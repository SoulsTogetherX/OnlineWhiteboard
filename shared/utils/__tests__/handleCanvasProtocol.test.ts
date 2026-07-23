import { describe, expect, it } from "vitest"

import { applyDrawInstructionToCanvas } from "../handleCanvasProtocol"
import { getIdxFromVec } from "../helperProtocolMethods"
import { canvasBytes } from "../../constants/canvas"

import {
  BASE,
  BLUE,
  DIMS,
  GREEN,
  RED,
  getPixel,
  makeCanvas,
  paintedCount,
  setPixel,
} from "./testHelpers"

import type { DrawInstruction, PatchInstruction } from "../../types/drawProtocol"
import type { ColorType } from "../../types/primitive"

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

    const applied = applyDrawInstructionToCanvas(pixels, inst, DIMS)

    expect(applied).toBe(inst)
    expect(getPixel(pixels, 3, 0)).toEqual(RED)
  })

  it("applies a bucket instruction and hands it straight back", () => {
    const pixels = makeCanvas()
    const inst = { type: "bucket", pos: [0, 0], color: RED, ...BASE } as DrawInstruction

    const applied = applyDrawInstructionToCanvas(pixels, inst, DIMS)

    expect(applied).toBe(inst)
    expect(paintedCount(pixels)).toBe(DIMS.width * DIMS.height)
  })

  it("returns a patch narrowed to only the entries that applied", () => {
    const pixels = makeCanvas()
    setPixel(pixels, 0, 0, RED)
    setPixel(pixels, 1, 0, GREEN)

    const inst: PatchInstruction = {
      type: "patch",
      entries: [
        { idx: getIdxFromVec([0, 0], DIMS), from: RED, to: BLUE },
        { idx: getIdxFromVec([1, 0], DIMS), from: RED, to: BLUE },
      ],
      ...BASE,
    }

    const applied = applyDrawInstructionToCanvas(pixels, inst, DIMS) as PatchInstruction

    expect(applied).not.toBeNull()
    expect(applied.entries).toHaveLength(1)
    // The original is not mutated — the server broadcasts the narrowed copy.
    expect(inst.entries).toHaveLength(2)
  })

  it("clears the whole canvas on a clear instruction", () => {
    const pixels = makeCanvas()
    // Paint something first.
    applyDrawInstructionToCanvas(pixels, {
      type: "bucket",
      pos: [0, 0],
      color: RED,
      ...BASE,
    } as DrawInstruction, DIMS)
    expect(paintedCount(pixels)).toBeGreaterThan(0)

    const applied = applyDrawInstructionToCanvas(pixels, {
      type: "clear",
      ...BASE,
    } as DrawInstruction, DIMS)

    expect(applied).not.toBeNull()
    expect(paintedCount(pixels)).toBe(0)
    expect(pixels.every((byte) => byte === 0)).toBe(true)
  })

  it("returns null when a patch applies nothing, so nothing is broadcast", () => {
    const pixels = makeCanvas()
    setPixel(pixels, 0, 0, GREEN)

    const applied = applyDrawInstructionToCanvas(pixels, {
      type: "patch",
      entries: [{ idx: getIdxFromVec([0, 0], DIMS), from: RED, to: BLUE }],
      ...BASE,
    }, DIMS)

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
    } as DrawInstruction, DIMS)

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
    } as DrawInstruction, DIMS)

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
      } as DrawInstruction, DIMS)

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
    } as unknown as DrawInstruction, DIMS)

    expect(applied).toBeNull()
  })

  it("rejects a bucket outside the canvas", () => {
    const pixels = makeCanvas()

    const applied = applyDrawInstructionToCanvas(pixels, {
      type: "bucket",
      pos: [DIMS.width, 0],
      color: RED,
      ...BASE,
    } as DrawInstruction, DIMS)

    expect(applied).toBeNull()
    expect(paintedCount(pixels)).toBe(0)
  })

  it("rejects patch entries with an out-of-range or misaligned index", () => {
    const pixels = makeCanvas()

    for (const idx of [-4, canvasBytes(DIMS), canvasBytes(DIMS) + 4, 3]) {
      const applied = applyDrawInstructionToCanvas(pixels, {
        type: "patch",
        entries: [{ idx, from: { r: 0, g: 0, b: 0, a: 0 }, to: RED }],
        ...BASE,
      }, DIMS)

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
    } as DrawInstruction, DIMS)

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
      } as unknown as DrawInstruction, DIMS)

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
    } as DrawInstruction, DIMS)

    expect(applied).not.toBeNull()
    expect(paintedCount(pixels)).toBeGreaterThan(1)
  })

  it("still accepts a legitimate edge-of-canvas instruction", () => {
    // Guard against over-zealous validation rejecting valid input.
    const pixels = makeCanvas()

    const applied = applyDrawInstructionToCanvas(pixels, {
      type: "pencil",
      prevPos: [0, 0],
      nextPos: [DIMS.width - 1, DIMS.height - 1],
      color: RED,
      ...BASE,
    } as DrawInstruction, DIMS)

    expect(applied).not.toBeNull()
    expect(getPixel(pixels, DIMS.width - 1, DIMS.height - 1)).toEqual(RED)
  })
})

describe("an instruction that changes nothing reports nothing", () => {
  // The server turns a null here into "no revision bump, no logged event, no
  // broadcast". Without it, drawing a colour over itself produced timeline steps
  // that render no visible change — scrubbing sat still through stretches of
  // history where nothing had actually happened.
  const line = (color: ColorType): DrawInstruction =>
    ({
      type: "pencil",
      prevPos: [0, 0],
      nextPos: [10, 0],
      color,
      ...BASE,
    }) as DrawInstruction

  it("returns null for a stroke drawn in the colour already there", () => {
    const pixels = makeCanvas()
    expect(applyDrawInstructionToCanvas(pixels, line(RED), DIMS)).not.toBeNull()

    // The identical stroke a second time changes not one pixel.
    expect(applyDrawInstructionToCanvas(pixels, line(RED), DIMS)).toBeNull()
  })

  it("still reports a stroke that changes even one pixel", () => {
    const pixels = makeCanvas()
    applyDrawInstructionToCanvas(pixels, line(RED), DIMS)

    expect(applyDrawInstructionToCanvas(pixels, line(BLUE), DIMS)).not.toBeNull()
  })

  it("returns null for a bucket fill of the colour already there", () => {
    const pixels = makeCanvas()
    const fill = (color: ColorType): DrawInstruction =>
      ({ type: "bucket", pos: [5, 5], color, ...BASE }) as DrawInstruction

    expect(applyDrawInstructionToCanvas(pixels, fill(GREEN), DIMS)).not.toBeNull()
    expect(applyDrawInstructionToCanvas(pixels, fill(GREEN), DIMS)).toBeNull()
  })

  it("returns null for a spray puff that lands only on its own colour", () => {
    const pixels = makeCanvas()
    const puff = (color: ColorType): DrawInstruction =>
      ({
        type: "spray",
        pos: [60, 60],
        radius: 8,
        density: 32,
        seed: 12345,
        color,
        ...BASE,
      }) as DrawInstruction

    // Flood the canvas red first, so the puff has nothing left to change.
    applyDrawInstructionToCanvas(
      pixels,
      { type: "bucket", pos: [0, 0], color: RED, ...BASE } as DrawInstruction,
      DIMS,
    )

    expect(applyDrawInstructionToCanvas(pixels, puff(RED), DIMS)).toBeNull()
    expect(applyDrawInstructionToCanvas(pixels, puff(BLUE), DIMS)).not.toBeNull()
  })

  it("writes the pixels either way — only the REPORT changes", () => {
    // A replaying caller ignores the return value and must still end up with the
    // same canvas, which is what keeps clients byte-identical to the server.
    const pixels = makeCanvas()
    applyDrawInstructionToCanvas(pixels, line(RED), DIMS)
    const painted = paintedCount(pixels)

    expect(applyDrawInstructionToCanvas(pixels, line(RED), DIMS)).toBeNull()
    expect(paintedCount(pixels)).toBe(painted)
    expect(getPixel(pixels, 5, 0)).toEqual(RED)
  })
})
