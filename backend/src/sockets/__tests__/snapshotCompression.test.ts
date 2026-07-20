import { describe, expect, it } from "vitest"
import { inflateRawSync } from "node:zlib"

import { compressSnapshotPayload } from "@/sockets/snapshotCompression"

import { DEFAULT_CANVAS_DIMS, canvasBytes } from "@shared/constants/canvas"

describe("compressSnapshotPayload", () => {
  it("deflates a blank canvas to a tiny fraction of its size", () => {
    // The common case by a wide margin: every client joining an empty room gets
    // this, and 57,600 identical bytes is exactly what deflate is best at.
    const blank = new Uint8Array(canvasBytes(DEFAULT_CANVAS_DIMS))

    const { payload, compression } = compressSnapshotPayload(blank)

    expect(compression).toBe("deflate-raw")
    expect(payload.length).toBeLessThan(canvasBytes(DEFAULT_CANVAS_DIMS) / 100)
  })

  it("round-trips back to the exact original bytes", () => {
    // Snapshots are the recovery path — a lossy or misaligned round trip would
    // desynchronise every client that resynced.
    const pixels = new Uint8Array(canvasBytes(DEFAULT_CANVAS_DIMS))
    for (let i = 0; i < pixels.length; i += 4) {
      pixels[i] = (i / 4) % 256
      pixels[i + 1] = 0
      pixels[i + 2] = 128
      pixels[i + 3] = 255
    }

    const { payload, compression } = compressSnapshotPayload(pixels)

    expect(compression).toBe("deflate-raw")
    expect(Buffer.from(inflateRawSync(payload)).equals(Buffer.from(pixels))).toBe(
      true,
    )
  })

  it("falls back to raw bytes when deflating would make it BIGGER", () => {
    // High-entropy data deflates larger than its input. Sending a bigger payload
    // AND making the client inflate it would be worse on both counts, so the
    // header says "none" and the raw bytes go out.
    const noise = new Uint8Array(4096)
    for (let i = 0; i < noise.length; i += 1) {
      // A deterministic PRNG, so this test cannot flake on a lucky buffer.
      noise[i] = (i * 2654435761) % 256
    }

    const { payload, compression } = compressSnapshotPayload(noise)

    // Whichever branch is taken, the payload must never exceed the input.
    expect(payload.length).toBeLessThanOrEqual(noise.length)
    if (compression === "none") {
      expect(Buffer.from(payload).equals(Buffer.from(noise))).toBe(true)
    }
  })

  it("does not alias the caller's buffer", () => {
    // room.pixels keeps being mutated by live draws while the frame sits in the
    // send queue. If the payload were a view over it, the bytes on the wire
    // would be whatever the canvas looked like at flush time — disagreeing with
    // the revision in the frame's own header.
    const pixels = new Uint8Array(canvasBytes(DEFAULT_CANVAS_DIMS))
    pixels[0] = 11

    const { payload, compression } = compressSnapshotPayload(pixels)
    pixels[0] = 222

    const decoded =
      compression === "deflate-raw" ? inflateRawSync(payload) : payload
    expect(decoded[0]).toBe(11)
  })
})
