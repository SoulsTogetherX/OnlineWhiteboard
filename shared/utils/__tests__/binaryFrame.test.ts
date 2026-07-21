import { describe, expect, it } from "vitest"

import {
  BINARY_FRAME_VERSION,
  decodeBinaryFrame,
  encodeBinaryFrame,
} from "../binaryFrame"

describe("binary frame codec", () => {
  it("round-trips a header and a payload", () => {
    const payload = new Uint8Array([1, 2, 3, 250, 0, 255])
    const frame = encodeBinaryFrame(
      { type: "canvas_snapshot", roomId: "r", revision: 7 },
      payload,
    )

    const decoded = decodeBinaryFrame(frame)

    expect(decoded).not.toBeNull()
    expect(decoded?.header).toEqual({
      type: "canvas_snapshot",
      roomId: "r",
      revision: 7,
    })
    expect(Array.from(decoded!.payload)).toEqual(Array.from(payload))
  })

  it("round-trips a full-size canvas payload without inflating it", () => {
    // The whole point of the change: 57,600 bytes stay 57,600 bytes on the wire
    // instead of becoming 76,800 base64 characters.
    const payload = new Uint8Array(57_600)
    for (let i = 0; i < payload.length; i += 1) {
      payload[i] = i % 256
    }

    const frame = encodeBinaryFrame({ type: "canvas_snapshot" }, payload)
    const decoded = decodeBinaryFrame(frame)

    expect(decoded?.payload.length).toBe(57_600)
    expect(Array.from(decoded!.payload.subarray(0, 8))).toEqual([
      0, 1, 2, 3, 4, 5, 6, 7,
    ])
    // Header is tiny, so the frame is the payload plus a rounding error — and
    // decisively smaller than the 76,800 chars base64 would have cost.
    expect(frame.length).toBeLessThan(58_000)
  })

  it("handles an empty payload", () => {
    const decoded = decodeBinaryFrame(
      encodeBinaryFrame({ type: "x" }, new Uint8Array(0)),
    )

    expect(decoded?.payload.length).toBe(0)
    expect(decoded?.header).toEqual({ type: "x" })
  })

  it("preserves non-ASCII in the header", () => {
    // Room ids and checkpoint names are user-supplied. A byte-length/char-length
    // mix-up here would truncate the header on the first multi-byte character.
    const decoded = decodeBinaryFrame(
      encodeBinaryFrame({ name: "café 🎨 room" }, new Uint8Array([9])),
    )

    expect(decoded?.header).toEqual({ name: "café 🎨 room" })
    expect(Array.from(decoded!.payload)).toEqual([9])
  })

  it("accepts an ArrayBuffer as well as a Uint8Array", () => {
    // The browser hands us an ArrayBuffer (binaryType = "arraybuffer"); Node's
    // ws hands us a Buffer. Both must decode.
    const frame = encodeBinaryFrame({ type: "x" }, new Uint8Array([1, 2]))
    const copy = new Uint8Array(frame) // detach from any pooled backing store

    expect(decodeBinaryFrame(copy.buffer)?.header).toEqual({ type: "x" })
  })

  it("decodes a frame sitting at a non-zero byteOffset", () => {
    // Node Buffers are views into a shared pool, so byteOffset is routinely
    // non-zero. A DataView built without honouring it reads someone else's bytes
    // — and would do so intermittently, which is the worst kind of bug.
    const frame = encodeBinaryFrame({ type: "offset" }, new Uint8Array([7, 8]))
    const backing = new Uint8Array(frame.length + 16)
    backing.set(frame, 16)
    const view = backing.subarray(16)

    const decoded = decodeBinaryFrame(view)

    expect(decoded?.header).toEqual({ type: "offset" })
    expect(Array.from(decoded!.payload)).toEqual([7, 8])
  })

  describe("malformed input is dropped, never half-applied", () => {
    it("rejects a frame shorter than the prefix", () => {
      expect(decodeBinaryFrame(new Uint8Array([1, 0]))).toBeNull()
    })

    it("rejects an unknown version", () => {
      const frame = encodeBinaryFrame({ type: "x" }, new Uint8Array([1]))
      frame[0] = BINARY_FRAME_VERSION + 1

      expect(decodeBinaryFrame(frame)).toBeNull()
    })

    it("rejects a header length that runs past the end of the frame", () => {
      const frame = encodeBinaryFrame({ type: "x" }, new Uint8Array([1]))
      new DataView(frame.buffer).setUint16(1, 60_000)

      expect(decodeBinaryFrame(frame)).toBeNull()
    })

    it("rejects a header that is not valid JSON", () => {
      const frame = encodeBinaryFrame({ type: "x" }, new Uint8Array([1]))
      // Replace the opening "{" with a letter, so the header reads A"type":"x"}
      // and cannot parse. (Writing 0x7b here would be a no-op — that IS "{".)
      frame[3] = 0x41 // "A"

      expect(decodeBinaryFrame(frame)).toBeNull()
    })

    it("rejects an empty buffer", () => {
      expect(decodeBinaryFrame(new Uint8Array(0))).toBeNull()
    })
  })
})
