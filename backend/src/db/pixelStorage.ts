//#region Why this exists
// Canvas pixels are stored gzipped in the `rgba` BYTEA columns of
// canvas_snapshots and checkpoints.
//
// The saving is large and grows with usage: every room keeps a rolling snapshot,
// every checkpoint keeps a full canvas (up to 20 per room), and a whiteboard is
// mostly transparent — 57,600 bytes of which the great majority are runs of
// identical zero bytes. Compressed, a blank canvas is under a hundred bytes.
// Uncompressed, twenty checkpoints of one room is 1.1 MB of mostly nothing.
//
// gzip rather than the raw deflate used on the wire, and deliberately so: gzip
// frames its payload with a magic number and a CRC32 of the uncompressed data.
// On the wire the frame header already says how the payload is encoded and a
// corrupt frame is one dropped message; in a database the bytes outlive the code
// that wrote them, nothing else records their format, and silent corruption is
// permanent. The CRC turns "this canvas is subtly wrong forever" into a loud
// failure at read time. Worth ~18 bytes a row.
//
// draw_events stays raw JSON (§16): instructions are tiny and on the
// latency-critical path, so compressing them would trade the thing that matters
// for the thing that does not.
//#endregion

//#region Imports
import { gunzipSync, gzipSync } from "node:zlib"

import { DEFAULT_CANVAS_DIMS, canvasBytes } from "@shared/constants/canvas"
//#endregion

//#region Pack / Unpack
// Compresses pixels for storage. Takes a copy by way of gzip's output, so the
// caller's buffer can keep being mutated by live draws.
export function packPixels(pixels: Uint8ClampedArray): Buffer {
  return gzipSync(Buffer.from(pixels.buffer, pixels.byteOffset, pixels.length))
}

// Decompresses a stored canvas, or returns null if the bytes are not a valid
// gzip stream of exactly one canvas.
//
// Null rather than throwing: this runs during room load, and an unreadable
// snapshot must degrade to "start this room blank" the same way a
// dimension mismatch already does — not take down the room, or worse, the
// process. The caller logs it; the event log may still replay on top.
export function unpackPixels(stored: Buffer): Uint8ClampedArray | null {
  let raw: Buffer
  try {
    raw = gunzipSync(stored)
  } catch {
    // Not gzip, truncated, or CRC mismatch.
    return null
  }

  // A stream that decompresses cleanly but holds the wrong number of bytes is
  // still unusable — and would otherwise produce a canvas of the wrong length
  // that every index calculation downstream trusts.
  if (raw.length !== canvasBytes(DEFAULT_CANVAS_DIMS)) {
    return null
  }

  return new Uint8ClampedArray(raw)
}
//#endregion
