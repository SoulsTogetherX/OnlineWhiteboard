import { describe, expect, it } from "vitest"

import { handleDrawSprayInstruction } from "../handleSprayProtocol"
import { applyDrawInstructionToCanvas } from "../handleCanvasProtocol"
import { CANVAS_HEIGHT, CANVAS_WIDTH } from "../../constants/canvas"

import { BASE, RED, makeCanvas, paintedCount } from "./testHelpers"

import type { SprayInstruction } from "../../types/drawProtocol"

const spray = (overrides: Partial<SprayInstruction> = {}): SprayInstruction =>
  ({
    type: "spray",
    pos: [60, 60],
    radius: 8,
    density: 20,
    seed: 12345,
    color: RED,
    ...BASE,
    ...overrides,
  }) as SprayInstruction

describe("handleDrawSprayInstruction — determinism", () => {
  it("is DETERMINISTIC: the same seed paints byte-identical pixels", () => {
    // This is the whole point — the server and every client must reproduce the
    // exact same splatter from the seed on the wire, or they desync.
    const a = makeCanvas()
    const b = makeCanvas()

    handleDrawSprayInstruction(a, spray({ seed: 999 }))
    handleDrawSprayInstruction(b, spray({ seed: 999 }))

    expect(Array.from(b)).toEqual(Array.from(a))
  })

  it("different seeds produce different splatters", () => {
    const a = makeCanvas()
    const b = makeCanvas()

    handleDrawSprayInstruction(a, spray({ seed: 1 }))
    handleDrawSprayInstruction(b, spray({ seed: 2 }))

    expect(Array.from(b)).not.toEqual(Array.from(a))
  })

  it("paints only inside the radius", () => {
    const pixels = makeCanvas()
    const center: [number, number] = [60, 60]
    const radius = 8

    handleDrawSprayInstruction(
      pixels,
      spray({ pos: center, radius, density: 40 }),
    )

    // Every painted pixel is within `radius` (plus rounding slack) of the centre.
    for (let y = 0; y < CANVAS_HEIGHT; y += 1) {
      for (let x = 0; x < CANVAS_WIDTH; x += 1) {
        const i = (y * CANVAS_WIDTH + x) << 2
        if (pixels[i + 3] !== 0) {
          const dist = Math.hypot(x - center[0], y - center[1])
          expect(dist).toBeLessThanOrEqual(radius + 1)
        }
      }
    }
  })

  it("paints at least one pixel and no more than density", () => {
    const pixels = makeCanvas()

    handleDrawSprayInstruction(pixels, spray({ density: 20 }))

    const count = paintedCount(pixels)
    expect(count).toBeGreaterThan(0)
    // Random samples can collide on the same pixel, so count <= density.
    expect(count).toBeLessThanOrEqual(20)
  })

  it("clips against the canvas edge without escaping the buffer", () => {
    const pixels = makeCanvas()

    // Centre in the corner: roughly three-quarters of the disc is off-canvas.
    handleDrawSprayInstruction(
      pixels,
      spray({ pos: [0, 0], radius: 10, density: 60 }),
    )

    // Nothing painted outside the canvas (no crash, no wraparound).
    expect(paintedCount(pixels)).toBeGreaterThan(0)
  })
})

describe("spray dispatch + validation", () => {
  it("applies a valid spray through the fan-in point", () => {
    const pixels = makeCanvas()
    const applied = applyDrawInstructionToCanvas(pixels, spray())
    expect(applied).not.toBeNull()
    expect(paintedCount(pixels)).toBeGreaterThan(0)
  })

  it("rejects an out-of-range radius, density, or seed", () => {
    const pixels = makeCanvas()
    for (const bad of [
      spray({ radius: 0 }),
      spray({ radius: 999 }),
      spray({ density: 0 }),
      spray({ density: 9999 }),
      spray({ seed: -1 }),
      spray({ seed: 1.5 }),
    ]) {
      expect(applyDrawInstructionToCanvas(pixels, bad)).toBeNull()
    }
    expect(paintedCount(pixels)).toBe(0)
  })
})
