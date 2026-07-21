import { describe, expect, it } from "vitest"

import { colorTypeToString, colorsEqual } from "../primitive"

// colorsEqual is load-bearing in two places that must never disagree: the flood
// fill uses it to decide which pixels to replace, and the compare-and-swap undo
// patch uses it to decide whether a pixel still holds the colour the patch
// expects. It used to exist as three separate copies (fill, patch, frontend);
// these tests cover the single shared implementation they all now call.
describe("colorsEqual", () => {
  it("compares every channel including alpha", () => {
    expect(
      colorsEqual({ r: 1, g: 2, b: 3, a: 4 }, { r: 1, g: 2, b: 3, a: 4 }),
    ).toBe(true)
    expect(
      colorsEqual({ r: 1, g: 2, b: 3, a: 4 }, { r: 1, g: 2, b: 3, a: 5 }),
    ).toBe(false)
  })

  it("treats a difference in any single channel as unequal", () => {
    const base = { r: 10, g: 20, b: 30, a: 40 }
    expect(colorsEqual(base, { ...base, r: 11 })).toBe(false)
    expect(colorsEqual(base, { ...base, g: 21 })).toBe(false)
    expect(colorsEqual(base, { ...base, b: 31 })).toBe(false)
    expect(colorsEqual(base, { ...base, a: 41 })).toBe(false)
  })

  // Alpha is the channel a naive RGB-only compare would drop. The eraser writes
  // fully-transparent pixels, so "same RGB, different alpha" is a real state on
  // this canvas — not a theoretical one.
  it("does not ignore alpha when the RGB channels match", () => {
    expect(
      colorsEqual({ r: 0, g: 0, b: 0, a: 0 }, { r: 0, g: 0, b: 0, a: 255 }),
    ).toBe(false)
  })
})

describe("colorTypeToString", () => {
  it("renders a css rgba() string with alpha normalised to 0-1", () => {
    expect(colorTypeToString({ r: 255, g: 128, b: 0, a: 255 })).toBe(
      "rgba(255, 128, 0, 1)",
    )
    expect(colorTypeToString({ r: 0, g: 0, b: 0, a: 0 })).toBe(
      "rgba(0, 0, 0, 0)",
    )
  })
})
