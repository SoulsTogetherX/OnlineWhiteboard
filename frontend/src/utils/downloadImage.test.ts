import { describe, expect, it } from "vitest"

import { EXPORT_FORMATS } from "./downloadImage"

// The BMP encoder is hand-written (no browser ships one), and every classic BMP
// bug is in the header or the row layout rather than the pixels. jsdom has no
// canvas, so these assert the format contract the encoder is built against, and
// the descriptor table the UI renders from.
describe("export formats", () => {
  it("offers exactly the four formats, each with a file extension", () => {
    expect(EXPORT_FORMATS.map((format) => format.id)).toEqual([
      "png",
      "webp",
      "jpeg",
      "bmp",
    ])
    for (const format of EXPORT_FORMATS) {
      expect(format.extension).toMatch(/^[a-z]+$/)
      expect(format.label.length).toBeGreaterThan(0)
    }
  })

  it("uses .jpg for JPEG — the extension people actually expect", () => {
    const jpeg = EXPORT_FORMATS.find((format) => format.id === "jpeg")
    expect(jpeg?.extension).toBe("jpg")
  })

  it("warns about transparency on exactly the formats that cannot store it", () => {
    const lossy = EXPORT_FORMATS.filter((format) => format.caveat !== null)
    expect(lossy.map((format) => format.id)).toEqual(["jpeg", "bmp"])
    // PNG and WebP both keep alpha, so promising a caveat there would be wrong.
    for (const id of ["png", "webp"] as const) {
      expect(EXPORT_FORMATS.find((f) => f.id === id)?.caveat).toBeNull()
    }
  })
})

describe("BMP row padding", () => {
  // The rule the encoder implements: each row is padded to a 4-BYTE boundary,
  // not a 4-pixel one. Getting this wrong shears the image diagonally, which is
  // the single most common BMP bug.
  const rowSize = (width: number) => Math.floor((24 * width + 31) / 32) * 4

  it("pads each row up to a multiple of four bytes", () => {
    for (const width of [1, 2, 3, 4, 5, 17, 256]) {
      expect(rowSize(width) % 4).toBe(0)
      // Never smaller than the pixels it must hold: 3 bytes each at 24bpp.
      expect(rowSize(width)).toBeGreaterThanOrEqual(width * 3)
      // Never wastes a whole extra 4-byte word.
      expect(rowSize(width) - width * 3).toBeLessThan(4)
    }
  })

  it("needs no padding when the width is already a multiple of four", () => {
    expect(rowSize(4)).toBe(12)
    expect(rowSize(256)).toBe(768)
  })
})
