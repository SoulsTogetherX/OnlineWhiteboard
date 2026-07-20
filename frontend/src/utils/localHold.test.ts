import { afterEach, describe, expect, it } from "vitest"

import {
  HOLD_DURATION_MS,
  clearHolds,
  hasLiveHolds,
  holdLocalPixels,
  latestExpiry,
  overlayHolds,
} from "./localHold"

import type { PatchEntry } from "@shared/types/drawProtocol"

// Holds live in a module-level map, so every test starts from empty.
afterEach(() => clearHolds())

const RED = { r: 255, g: 0, b: 0, a: 255 }
const BLUE = { r: 0, g: 0, b: 255, a: 255 }

// `from` is irrelevant to a hold (only the painted-TO colour is shown), so fill
// it with anything.
const paintedAt = (idx: number, to = RED): PatchEntry => ({
  idx,
  from: { r: 0, g: 0, b: 0, a: 0 },
  to,
})

describe("localHold — display-only overlay", () => {
  it("returns null when nothing is held, so the caller blits the base unchanged", () => {
    expect(overlayHolds(new Uint8ClampedArray(16), 0)).toBeNull()
  })

  it("stamps a held pixel on top of the base without mutating the base", () => {
    const base = new Uint8ClampedArray(16) // 4 pixels, all transparent
    holdLocalPixels([paintedAt(4, BLUE)], 1000)

    const out = overlayHolds(base, 1000)

    expect(out).not.toBeNull()
    // Pixel 1 (byte 4) shows the held BLUE...
    expect(Array.from(out!.subarray(4, 8))).toEqual([0, 0, 255, 255])
    // ...the base is untouched (still the server's truth)...
    expect(Array.from(base)).toEqual(Array(16).fill(0))
    // ...and other pixels come straight from the base.
    expect(Array.from(out!.subarray(0, 4))).toEqual([0, 0, 0, 0])
  })

  it("shows the base's colour, not the hold, once the hold has expired", () => {
    // The convergence half of the guarantee: after the window the held pixel must
    // reveal whatever the authoritative buffer now holds — here a remote BLUE
    // painted over the spot the local user had painted RED.
    const remoteBuffer = new Uint8ClampedArray([0, 0, 255, 255]) // one BLUE pixel
    holdLocalPixels([paintedAt(0, RED)], 1000)

    // Within the window: the local RED wins the display.
    const held = overlayHolds(remoteBuffer, 1000 + HOLD_DURATION_MS - 1)
    expect(Array.from(held!)).toEqual([255, 0, 0, 255])

    // At expiry: nothing is held, so the caller blits the base — the remote BLUE.
    expect(overlayHolds(remoteBuffer, 1000 + HOLD_DURATION_MS)).toBeNull()
  })

  it("expires exactly at now + HOLD_DURATION_MS, not before", () => {
    holdLocalPixels([paintedAt(0)], 500)

    expect(hasLiveHolds(500 + HOLD_DURATION_MS - 1)).toBe(true)
    // Re-hold, since the check above pruned nothing but time moved on.
    holdLocalPixels([paintedAt(0)], 500)
    expect(hasLiveHolds(500 + HOLD_DURATION_MS)).toBe(false)
  })

  it("a later paint at the same pixel replaces the earlier hold and its expiry", () => {
    const base = new Uint8ClampedArray(4)
    holdLocalPixels([paintedAt(0, RED)], 1000)
    holdLocalPixels([paintedAt(0, BLUE)], 1050) // same pixel, later

    // Shows the newer colour...
    expect(Array.from(overlayHolds(base, 1060)!)).toEqual([0, 0, 255, 255])
    // ...and lives to the NEWER expiry, past when the first would have died.
    expect(hasLiveHolds(1000 + HOLD_DURATION_MS + 1)).toBe(true)
  })

  it("reports the latest expiry so a single timer can cover every hold", () => {
    holdLocalPixels([paintedAt(0)], 1000)
    holdLocalPixels([paintedAt(4)], 1030)

    expect(latestExpiry()).toBe(1030 + HOLD_DURATION_MS)
  })

  it("never writes past the end of the base buffer", () => {
    // A hold whose index sits beyond a (smaller) base must be skipped, not throw
    // or corrupt — the guard that matters once canvases can differ in size.
    const base = new Uint8ClampedArray(8)
    holdLocalPixels([paintedAt(4, RED), paintedAt(9999, BLUE)], 1000)

    const out = overlayHolds(base, 1000)

    expect(out).not.toBeNull()
    expect(Array.from(out!.subarray(4, 8))).toEqual([255, 0, 0, 255])
    expect(out!.length).toBe(8)
  })

  it("clearHolds drops everything, so one room's strokes never reach another", () => {
    holdLocalPixels([paintedAt(0)], 1000)
    clearHolds()

    expect(overlayHolds(new Uint8ClampedArray(4), 1000)).toBeNull()
  })
})
