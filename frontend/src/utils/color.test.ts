import { describe, expect, it } from "vitest"

import {
  colorToHex,
  colorToHex8,
  colorsEqual,
  hexToColor,
  hsvToRgb,
  rgbToHsv,
} from "./color"

describe("rgbToHsv / hsvToRgb", () => {
  it("maps the primary colors to the expected hues", () => {
    expect(rgbToHsv(255, 0, 0).h).toBeCloseTo(0)
    expect(rgbToHsv(0, 255, 0).h).toBeCloseTo(120)
    expect(rgbToHsv(0, 0, 255).h).toBeCloseTo(240)
  })

  it("reports greys as zero saturation", () => {
    expect(rgbToHsv(128, 128, 128).s).toBe(0)
    expect(rgbToHsv(0, 0, 0).v).toBe(0)
    expect(rgbToHsv(255, 255, 255).v).toBe(1)
  })

  it("round-trips a spread of colors through HSV and back", () => {
    const samples = [
      [255, 0, 0],
      [0, 255, 0],
      [0, 0, 255],
      [128, 64, 200],
      [17, 200, 90],
      [255, 255, 255],
      [0, 0, 0],
      [123, 45, 67],
    ]
    for (const [r, g, b] of samples) {
      const { h, s, v } = rgbToHsv(r, g, b)
      const back = hsvToRgb(h, s, v)
      // Allow ±1 for rounding through the colour spaces.
      expect(Math.abs(back.r - r)).toBeLessThanOrEqual(1)
      expect(Math.abs(back.g - g)).toBeLessThanOrEqual(1)
      expect(Math.abs(back.b - b)).toBeLessThanOrEqual(1)
    }
  })
})

describe("hex conversion", () => {
  it("formats a color as #rrggbb and #rrggbbaa", () => {
    expect(colorToHex({ r: 255, g: 0, b: 128, a: 255 })).toBe("#ff0080")
    expect(colorToHex8({ r: 255, g: 0, b: 128, a: 16 })).toBe("#ff008010")
  })

  it("parses 3, 6 and 8 digit hex", () => {
    expect(hexToColor("#f00")).toEqual({ r: 255, g: 0, b: 0, a: 255 })
    expect(hexToColor("00ff00")).toEqual({ r: 0, g: 255, b: 0, a: 255 })
    expect(hexToColor("#0000ff80")).toEqual({ r: 0, g: 0, b: 255, a: 128 })
  })

  it("rejects malformed hex", () => {
    expect(hexToColor("#xyz")).toBeNull()
    expect(hexToColor("#12345")).toBeNull()
    expect(hexToColor("nonsense")).toBeNull()
  })

  it("round-trips color -> hex8 -> color", () => {
    const color = { r: 12, g: 200, b: 44, a: 130 }
    expect(hexToColor(colorToHex8(color))).toEqual(color)
  })
})

describe("colorsEqual", () => {
  it("compares every channel including alpha", () => {
    expect(colorsEqual({ r: 1, g: 2, b: 3, a: 4 }, { r: 1, g: 2, b: 3, a: 4 })).toBe(true)
    expect(colorsEqual({ r: 1, g: 2, b: 3, a: 4 }, { r: 1, g: 2, b: 3, a: 5 })).toBe(false)
  })
})
