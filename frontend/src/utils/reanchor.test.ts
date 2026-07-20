import { describe, expect, it } from "vitest"

import { reanchorEntries, reanchorIndex } from "./reanchor"

import type { PatchEntry } from "@shared/types/drawProtocol"

const RED = { r: 255, g: 0, b: 0, a: 255 }
const BLUE = { r: 0, g: 0, b: 255, a: 255 }

// idx for pixel (x, y) at a given width.
const at = (x: number, y: number, w: number) => (y * w + x) * 4

describe("reanchorIndex — top-left anchored", () => {
  it("keeps the top-left pixel at index 0 regardless of size", () => {
    expect(reanchorIndex(0, { width: 256, height: 256 }, { width: 64, height: 64 })).toBe(0)
    expect(reanchorIndex(0, { width: 64, height: 64 }, { width: 512, height: 512 })).toBe(0)
  })

  it("preserves (x, y) and only changes the stride when growing", () => {
    const from = { width: 120, height: 120 }
    const to = { width: 256, height: 256 }
    // Pixel (5, 5) keeps its coordinate; its byte index moves to the new stride.
    expect(reanchorIndex(at(5, 5, 120), from, to)).toBe(at(5, 5, 256))
  })

  it("preserves (x, y) when shrinking, for a pixel still in bounds", () => {
    const from = { width: 256, height: 256 }
    const to = { width: 128, height: 96 }
    expect(reanchorIndex(at(5, 5, 256), from, to)).toBe(at(5, 5, 128))
    // A pixel at the very corner of the new canvas survives.
    expect(reanchorIndex(at(127, 95, 256), from, to)).toBe(at(127, 95, 128))
  })

  it("drops a pixel cropped away on the X axis", () => {
    const from = { width: 256, height: 256 }
    const to = { width: 128, height: 128 }
    // x = 200 is beyond the new width of 128.
    expect(reanchorIndex(at(200, 5, 256), from, to)).toBeNull()
    // Exactly on the new edge (x = 128) is OUT — valid indices are 0..127.
    expect(reanchorIndex(at(128, 0, 256), from, to)).toBeNull()
  })

  it("drops a pixel cropped away on the Y axis", () => {
    const from = { width: 256, height: 256 }
    const to = { width: 256, height: 100 }
    expect(reanchorIndex(at(5, 200, 256), from, to)).toBeNull()
    expect(reanchorIndex(at(5, 100, 256), from, to)).toBeNull()
    expect(reanchorIndex(at(5, 99, 256), from, to)).toBe(at(5, 99, 256))
  })
})

describe("reanchorEntries", () => {
  const entries: PatchEntry[] = [
    { idx: at(1, 1, 256), from: RED, to: BLUE },
    { idx: at(200, 1, 256), from: RED, to: BLUE }, // cropped on a shrink to 128
    { idx: at(1, 200, 256), from: RED, to: BLUE }, // cropped on a shrink to 128
  ]

  it("keeps every entry when growing, re-indexed to the new stride", () => {
    const out = reanchorEntries(entries, { width: 256, height: 256 }, { width: 512, height: 512 })

    expect(out).toHaveLength(3)
    expect(out[0].idx).toBe(at(1, 1, 512))
    expect(out[1].idx).toBe(at(200, 1, 512))
    expect(out[2].idx).toBe(at(1, 200, 512))
    // Colours are untouched — the CAS still expects the same from/to.
    expect(out[0].from).toEqual(RED)
    expect(out[0].to).toEqual(BLUE)
  })

  it("drops only the entries whose pixel the shrink cut away", () => {
    const out = reanchorEntries(entries, { width: 256, height: 256 }, { width: 128, height: 128 })

    expect(out).toHaveLength(1)
    expect(out[0].idx).toBe(at(1, 1, 128))
  })

  it("returns an empty list when the whole action falls outside the new canvas", () => {
    const farCorner: PatchEntry[] = [{ idx: at(250, 250, 256), from: RED, to: BLUE }]

    expect(reanchorEntries(farCorner, { width: 256, height: 256 }, { width: 64, height: 64 })).toEqual([])
  })
})
