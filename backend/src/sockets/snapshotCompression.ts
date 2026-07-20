//#region Why this exists
// Compresses the canvas snapshot PAYLOAD, and only the payload.
//
// This is the application-level answer to a bandwidth problem that
// transport-level compression would also solve, but unsafely. `ws` supports
// permessage-deflate; server.ts sets it explicitly to false, because when
// attacker-influenced data shares a compression context with secrets the
// compressed SIZE leaks content — the CRIME/BREACH class. Compressing here
// means the compressed buffer holds pixel bytes and nothing else, so no oracle
// exists: there is no secret in the context to leak. Same bandwidth win, no
// class of attack. Do not "simplify" this by turning the transport flag back on
// (CLAUDE.md §16 records the full reasoning).
//
// Raw deflate rather than gzip or zlib: the frame header already says what the
// payload is, so the 18-byte gzip wrapper and the 6-byte zlib wrapper are pure
// overhead. The browser's DecompressionStream speaks "deflate-raw" natively.
//
// Synchronous on purpose. 57,600 bytes of RGBA deflates in well under a
// millisecond, snapshots are sent on join and resync rather than per stroke, and
// making it async would push makeSnapshotFrame async and with it every caller —
// a lot of contagion to dodge a cost that does not show up in a profile.
//#endregion

//#region Imports
import { deflateRawSync } from "node:zlib"

import type { SnapshotCompression } from "@shared/types/socketProtocol"
//#endregion

//#region Compression
export type CompressedSnapshot = {
  payload: Buffer
  compression: SnapshotCompression
}

// Deflates the pixels, but falls back to raw bytes if compression did not
// actually help. A canvas of high-entropy noise can deflate LARGER than its
// input, and sending a bigger payload plus a decompression step would be worse
// on both counts. The header field makes this free to express, and the client
// handles either answer.
// Accepts either view because RoomState.pixels is a Uint8ClampedArray (what the
// shared draw algorithms write into) while most byte APIs hand back Uint8Array.
// Both are 8-bit views over the same bytes; the clamping only affects writes.
export function compressSnapshotPayload(
  pixels: Uint8Array | Uint8ClampedArray,
): CompressedSnapshot {
  const deflated = deflateRawSync(pixels)

  if (deflated.length >= pixels.length) {
    return { payload: Buffer.from(pixels), compression: "none" }
  }

  return { payload: deflated, compression: "deflate-raw" }
}
//#endregion
