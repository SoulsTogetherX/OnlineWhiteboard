import { describe, expect, it } from "vitest"

import { resizePixels } from "../helperProtocolMethods"

import type { CanvasDims } from "../../constants/canvas"

// A tiny helper: build a WxH buffer where each pixel's R channel encodes a value
// so a crop/pad is easy to assert on. R = 10*x + y + 1 (so 0 stays "empty").
function grid(dims: CanvasDims): Uint8ClampedArray {
  const px = new Uint8ClampedArray(dims.width * dims.height * 4)
  for (let y = 0; y < dims.height; y += 1) {
    for (let x = 0; x < dims.width; x += 1) {
      const i = (y * dims.width + x) * 4
      px[i] = 10 * x + y + 1
      px[i + 3] = 255
    }
  }
  return px
}

const rAt = (px: Uint8ClampedArray, dims: CanvasDims, x: number, y: number) =>
  px[(y * dims.width + x) * 4]

describe("resizePixels — top-left anchored crop/pad", () => {
  it("returns a buffer of exactly the new dimensions", () => {
    const from = { width: 4, height: 4 }
    const to = { width: 6, height: 3 }

    const out = resizePixels(grid(from), from, to)

    expect(out.length).toBe(to.width * to.height * 4)
  })

  it("keeps the top-left region byte-identical when growing", () => {
    const from = { width: 3, height: 3 }
    const to = { width: 5, height: 5 }

    const out = resizePixels(grid(from), from, to)

    // Every original pixel is where it was — the stride changed, so this only
    // holds because the copy is row-by-row, not a single set().
    for (let y = 0; y < from.height; y += 1) {
      for (let x = 0; x < from.width; x += 1) {
        expect(rAt(out, to, x, y)).toBe(10 * x + y + 1)
      }
    }
  })

  it("pads the new region with transparent zero pixels when growing", () => {
    const from = { width: 2, height: 2 }
    const to = { width: 4, height: 4 }

    const out = resizePixels(grid(from), from, to)

    // A pixel outside the original bounds is fully zero (transparent).
    const i = (3 * to.width + 3) * 4
    expect([out[i], out[i + 1], out[i + 2], out[i + 3]]).toEqual([0, 0, 0, 0])
  })

  it("discards the pixels past the new edge when shrinking", () => {
    const from = { width: 4, height: 4 }
    const to = { width: 2, height: 2 }

    const out = resizePixels(grid(from), from, to)

    // Kept region matches...
    expect(rAt(out, to, 0, 0)).toBe(grid(from)[0])
    expect(rAt(out, to, 1, 1)).toBe(10 * 1 + 1 + 1)
    // ...and the buffer is exactly the smaller size (nothing past it exists).
    expect(out.length).toBe(2 * 2 * 4)
  })

  it("handles a width-only change without shearing rows", () => {
    // The classic bug a single set() would cause: differing strides misalign
    // every row after the first. Shrink width, keep height.
    const from = { width: 4, height: 3 }
    const to = { width: 2, height: 3 }

    const out = resizePixels(grid(from), from, to)

    // Row 2's kept pixels must still read as row 2, not smeared from row 1/3.
    expect(rAt(out, to, 0, 2)).toBe(10 * 0 + 2 + 1)
    expect(rAt(out, to, 1, 2)).toBe(10 * 1 + 2 + 1)
  })

  it("is a byte-exact copy when dimensions are unchanged", () => {
    const dims = { width: 3, height: 3 }
    const src = grid(dims)

    const out = resizePixels(src, dims, dims)

    expect(Array.from(out)).toEqual(Array.from(src))
    // ...but a fresh buffer, not the same reference (callers may mutate).
    expect(out).not.toBe(src)
  })
})
