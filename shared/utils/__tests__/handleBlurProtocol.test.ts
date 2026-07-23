// Blur is the only instruction whose output is computed FROM the canvas, so the
// properties that matter here are different from the other tools': not "did it
// paint the right colour" but "does everyone compute the SAME thing".

import { describe, expect, it } from "vitest"

import { applyDrawInstructionToCanvas } from "../handleCanvasProtocol"
import { handleDrawBlurInstruction } from "../handleBlurProtocol"

import { BASE, BLUE, DIMS, RED, getPixel, makeCanvas, setPixel } from "./testHelpers"

import type { BlurInstruction, DrawInstruction } from "../../types/drawProtocol"

function blur(overrides: Partial<BlurInstruction> = {}): BlurInstruction {
  return {
    type: "blur",
    pos: [10, 10],
    radius: 4,
    blend: 2,
    opacity: 100,
    lockAlpha: false,
    ...BASE,
    ...overrides,
  } as BlurInstruction
}

// A hard red/blue edge down the middle of the blur's footprint — the arrangement
// where blurring visibly does something.
function edgeCanvas(): Uint8ClampedArray {
  const pixels = makeCanvas()
  for (let y = 5; y < 16; y += 1) {
    for (let x = 5; x < 16; x += 1) {
      setPixel(pixels, x, y, x < 10 ? RED : BLUE)
    }
  }
  return pixels
}

describe("blur is deterministic", () => {
  // The whole reason every parameter travels on the wire. If two clients can
  // compute different pixels from the same instruction, they diverge silently
  // and permanently — there is no later broadcast that corrects it, because both
  // believe they applied the instruction correctly.
  it("produces byte-identical output for the same input", () => {
    const a = edgeCanvas()
    const b = edgeCanvas()

    handleDrawBlurInstruction(a, blur(), DIMS)
    handleDrawBlurInstruction(b, blur(), DIMS)

    expect(Array.from(a)).toEqual(Array.from(b))
  })

  it("samples from the pre-blur canvas, not from its own output", () => {
    // If sampling were live, the result would depend on traversal order and the
    // smear would drag in that direction. Symmetry is the observable proof it
    // does not: a vertically symmetric input must stay vertically symmetric.
    const pixels = makeCanvas()
    for (let y = 5; y < 16; y += 1) {
      for (let x = 5; x < 16; x += 1) {
        setPixel(pixels, x, y, x < 10 ? RED : BLUE)
      }
    }
    handleDrawBlurInstruction(pixels, blur({ pos: [10, 10] }), DIMS)

    // Rows equidistant above and below the centre must be identical.
    for (let dx = -3; dx <= 3; dx += 1) {
      expect(getPixel(pixels, 10 + dx, 9)).toEqual(getPixel(pixels, 10 + dx, 11))
    }
  })
})

describe("blur parameters", () => {
  it("actually softens a hard edge", () => {
    const pixels = edgeCanvas()
    const before = getPixel(pixels, 9, 10)
    handleDrawBlurInstruction(pixels, blur(), DIMS)
    const after = getPixel(pixels, 9, 10)

    expect(after).not.toEqual(before)
    // The pixel was pure red and had blue neighbours, so it must have gained
    // blue without becoming blue.
    expect(after.b).toBeGreaterThan(0)
    expect(after.r).toBeGreaterThan(0)
  })

  it("mixes less at a lower opacity", () => {
    const strong = edgeCanvas()
    const weak = edgeCanvas()
    handleDrawBlurInstruction(strong, blur({ opacity: 100 }), DIMS)
    handleDrawBlurInstruction(weak, blur({ opacity: 20 }), DIMS)

    // The weakly blurred pixel stays closer to the red it started as.
    expect(getPixel(weak, 9, 10).r).toBeGreaterThan(getPixel(strong, 9, 10).r)
  })

  it("leaves alpha untouched when alpha is locked", () => {
    // A shape against transparency: exactly where an unlocked blur erodes edges.
    const pixels = makeCanvas()
    for (let y = 8; y < 13; y += 1) {
      for (let x = 8; x < 13; x += 1) {
        setPixel(pixels, x, y, RED)
      }
    }
    const locked = new Uint8ClampedArray(pixels)

    handleDrawBlurInstruction(pixels, blur({ lockAlpha: false }), DIMS)
    handleDrawBlurInstruction(locked, blur({ lockAlpha: true }), DIMS)

    // Unlocked, the opaque square's edge loses alpha to its transparent
    // neighbours; locked, every alpha value is exactly as it started.
    expect(getPixel(pixels, 8, 10).a).toBeLessThan(255)
    expect(getPixel(locked, 8, 10).a).toBe(255)
    // ...and the colour is untouched, because the only colour anywhere in the
    // neighbourhood IS red. See the transparency tests below.
    expect(getPixel(locked, 8, 10)).toEqual(RED)
  })
})

describe("transparent pixels contribute no colour", () => {
  // A transparent pixel is "nothing", not "black". Its RGB bytes are usually
  // zero, and a plain average reads those zeros as black — so blurring the edge
  // of a drawing against empty canvas used to drag a dark halo inwards.
  //
  // The rule: colour is averaged weighted by alpha, alpha is averaged plainly.
  // Across an edge that means the opaque side's colour is carried outwards (it
  // is the only colour in the sum) and what varies is the alpha alone.
  function redSquare(): Uint8ClampedArray {
    const pixels = makeCanvas()
    for (let y = 8; y < 13; y += 1) {
      for (let x = 8; x < 13; x += 1) {
        setPixel(pixels, x, y, RED)
      }
    }
    return pixels
  }

  it("never darkens an edge against empty canvas", () => {
    const pixels = redSquare()
    handleDrawBlurInstruction(pixels, blur({ opacity: 100 }), DIMS)

    // Every pixel that ended up with any opacity must still be pure red. A
    // non-zero green or blue channel would mean black bled in; a reduced red
    // would mean it was dimmed towards black.
    for (let y = 6; y < 15; y += 1) {
      for (let x = 6; x < 15; x += 1) {
        const pixel = getPixel(pixels, x, y)
        if (pixel.a > 0) {
          expect({ r: pixel.r, g: pixel.g, b: pixel.b }).toEqual({
            r: 255,
            g: 0,
            b: 0,
          })
        }
      }
    }
  })

  it("spreads the opaque colour outwards and varies only alpha", () => {
    const pixels = redSquare()
    // Just outside the square: transparent, and black in RGB to begin with.
    expect(getPixel(pixels, 7, 10)).toEqual({ r: 0, g: 0, b: 0, a: 0 })

    handleDrawBlurInstruction(pixels, blur({ opacity: 100 }), DIMS)

    const outside = getPixel(pixels, 7, 10)
    expect(outside.a).toBeGreaterThan(0)
    expect(outside.a).toBeLessThan(255)
    // It took the square's colour rather than averaging towards black.
    expect({ r: outside.r, g: outside.g, b: outside.b }).toEqual({
      r: 255,
      g: 0,
      b: 0,
    })
  })

  it("leaves colour alone where the whole neighbourhood is transparent", () => {
    // Nothing to average towards, so nothing should move — returning zeros here
    // would reintroduce the black bleed by another route.
    const pixels = makeCanvas()
    setPixel(pixels, 40, 40, { r: 12, g: 34, b: 56, a: 0 })

    handleDrawBlurInstruction(pixels, blur({ pos: [40, 40] }), DIMS)

    expect(getPixel(pixels, 40, 40)).toEqual({ r: 12, g: 34, b: 56, a: 0 })
  })
})

describe("blur through the fan-in", () => {
  it("reports a blur over a flat area as a no-op", () => {
    // Nothing to average — every neighbour is already the same colour — so this
    // must stay out of the timeline like any other instruction that changes
    // nothing.
    const pixels = makeCanvas()
    for (let y = 0; y < DIMS.height; y += 1) {
      for (let x = 0; x < DIMS.width; x += 1) {
        setPixel(pixels, x, y, RED)
      }
    }

    expect(
      applyDrawInstructionToCanvas(pixels, blur() as DrawInstruction, DIMS),
    ).toBeNull()
  })

  it("rejects out-of-range parameters", () => {
    // Each of these would make this client compute different pixels from
    // everyone else, so the fan-in has to refuse them rather than clamp.
    for (const bad of [
      { blend: 0 },
      { blend: 99 },
      { opacity: 0 },
      { opacity: 101 },
      { radius: 0 },
    ]) {
      expect(
        applyDrawInstructionToCanvas(
          edgeCanvas(),
          blur(bad) as DrawInstruction,
          DIMS,
        ),
      ).toBeNull()
    }
  })

  it("rejects a non-boolean lockAlpha", () => {
    expect(
      applyDrawInstructionToCanvas(
        edgeCanvas(),
        blur({ lockAlpha: "yes" as unknown as boolean }) as DrawInstruction,
        DIMS,
      ),
    ).toBeNull()
  })
})
