import { describe, expect, it } from "vitest"
import { gzipSync } from "node:zlib"

import { packPixels, unpackPixels } from "@/db/pixelStorage"

import { CANVAS_BYTES } from "@shared/constants/canvas"

describe("pixelStorage", () => {
  it("round-trips a canvas byte for byte", () => {
    const pixels = new Uint8ClampedArray(CANVAS_BYTES)
    for (let i = 0; i < pixels.length; i += 1) {
      pixels[i] = (i * 7) % 256
    }

    const restored = unpackPixels(packPixels(pixels))

    expect(restored).not.toBeNull()
    expect(Buffer.from(restored!).equals(Buffer.from(pixels))).toBe(true)
  })

  it("stores a blank canvas in a tiny fraction of its size", () => {
    // The dominant case: most rooms are mostly transparent, and every room keeps
    // a rolling snapshot plus up to 20 checkpoints.
    const packed = packPixels(new Uint8ClampedArray(CANVAS_BYTES))

    expect(packed.length).toBeLessThan(CANVAS_BYTES / 100)
  })

  it("returns null for bytes that are not gzip at all", () => {
    // What a pre-compression row would look like. Must degrade, not throw:
    // this runs during room load.
    expect(unpackPixels(Buffer.from(new Uint8Array(CANVAS_BYTES)))).toBeNull()
  })

  it("returns null for a truncated gzip stream", () => {
    const packed = packPixels(new Uint8ClampedArray(CANVAS_BYTES))

    expect(unpackPixels(packed.subarray(0, packed.length - 5))).toBeNull()
  })

  it("returns null when the stream decompresses to the wrong size", () => {
    // Valid gzip, wrong contents — the case a CRC cannot catch, because the CRC
    // is correct for the bytes that are there. A canvas of the wrong length
    // would otherwise be trusted by every index calculation downstream.
    const wrongSize = gzipSync(Buffer.alloc(CANVAS_BYTES - 4))

    expect(unpackPixels(wrongSize)).toBeNull()
  })

  it("detects corruption in the middle of the stream", () => {
    // This is what gzip's CRC32 buys over raw deflate, and why storage uses gzip
    // while the wire uses deflate-raw: stored bytes outlive the code that wrote
    // them, and silent corruption there is permanent.
    const packed = packPixels(new Uint8ClampedArray(CANVAS_BYTES))
    const corrupted = Buffer.from(packed)
    corrupted[Math.floor(corrupted.length / 2)] ^= 0xff

    expect(unpackPixels(corrupted)).toBeNull()
  })

  it("does not alias the caller's buffer", () => {
    const pixels = new Uint8ClampedArray(CANVAS_BYTES)
    pixels[0] = 42

    const packed = packPixels(pixels)
    pixels[0] = 7

    expect(unpackPixels(packed)![0]).toBe(42)
  })
})
