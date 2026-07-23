//#region Why this exists
// Packs a patch instruction's entries into bytes for the wire.
//
// A patch is the one client->server message that can be huge. Undoing a
// full-canvas bucket fill is one entry per pixel — 14,400 of them — and as JSON
// each entry is `{"idx":57596,"from":{"r":0,"g":0,"b":0,"a":0},"to":{...}}`,
// about a hundred bytes. That is ~1.4 MB for a single undo, and the whole reason
// maxPayload has to sit in the megabytes at all (§1.1 in the phase notes): the
// ceiling that stops a hostile 100 MiB frame is pinned open by one legitimate
// feature, and packing is what keeps that ceiling as low as it can go.
//
// Packed, an entry is 11 bytes flat: a u24 PIXEL index and two RGBA quadruplets.
// The same 14,400-entry patch is ~158 KB, roughly a 9x shrink, which lets
// maxPayload come down to 3 MiB — a real tightening of the attack surface, paid
// for by the feature that forced it open rather than by weakening it.
//
// Unlike the snapshot COMPRESSION codec (which is split across node:zlib and the
// browser's DecompressionStream), this pair is symmetric and environment-neutral
// — plain byte reads on both sides — so it lives in shared/ like the draw
// algorithms, one implementation the server and client cannot drift apart on.
//
// Why the index is stored as a PIXEL index in a u24, when in memory it is a BYTE
// offset (pixel * 4). Three reasons, and the first is why it is not a u16:
//
//   - A u16 tops out at 65,535. The largest canvas is 512x512 = 262,144 pixels,
//     so a u16 pixel index overflows outright (and 256x256 sits exactly at its
//     ceiling with no headroom). u24 holds up to 16,777,215 — every pixel of a
//     canvas up to 4096x4096 — so there is generous room above today's max.
//   - The byte OFFSET needs 20 bits (up to 1,048,572 on a 512 canvas), but the
//     PIXEL index needs only 18. Storing the pixel index is what makes 3 bytes
//     enough where the offset would have needed a fourth. The `<< 2` on decode
//     turns it back into the byte offset every consumer expects, so nothing
//     downstream changes — the compression lives entirely in this file.
//   - Because decode reconstructs the offset by shifting left by 2, the result
//     is ALWAYS a multiple of 4. A misaligned byte offset — which
//     validateInstruction otherwise has to reject with `(idx & 3) === 0` —
//     becomes impossible to even express on the wire.
//#endregion

//#region Imports
import { MAX_PATCH_ENTRIES } from "../constants/canvas"
import { decodeBinaryFrame, encodeBinaryFrame } from "./binaryFrame"

import type { PatchEntry, PatchInstruction } from "../types/drawProtocol"
//#endregion

//#region Constants
// u24 pixel index (3) + RGBA from (4) + RGBA to (4). Exported so the codec
// tests assert against the format rather than a hardcoded literal that could
// silently disagree.
export const BYTES_PER_ENTRY = 11
//#endregion

//#region Entry packing
export function encodePatchEntries(entries: PatchEntry[]): Uint8Array {
  const bytes = new Uint8Array(entries.length * BYTES_PER_ENTRY)

  // Plain byte writes rather than a DataView: a u24 has no setUint24, and the
  // three explicit bytes are clearer than masking a u32 write anyway.
  let offset = 0
  for (const entry of entries) {
    // Byte offset -> pixel index. `>>> 2` (unsigned) is the exact inverse of the
    // `<< 2` on decode; the low two bits are always zero because the offset is
    // pixel-aligned, so nothing is lost.
    const pixel = entry.idx >>> 2
    bytes[offset] = (pixel >>> 16) & 0xff
    bytes[offset + 1] = (pixel >>> 8) & 0xff
    bytes[offset + 2] = pixel & 0xff
    bytes[offset + 3] = entry.from.r
    bytes[offset + 4] = entry.from.g
    bytes[offset + 5] = entry.from.b
    bytes[offset + 6] = entry.from.a
    bytes[offset + 7] = entry.to.r
    bytes[offset + 8] = entry.to.g
    bytes[offset + 9] = entry.to.b
    bytes[offset + 10] = entry.to.a
    offset += BYTES_PER_ENTRY
  }
  return bytes
}

// Returns null for a payload that cannot be a valid entry list: a length that is
// not a whole number of entries, or more entries than a patch is ever allowed to
// carry. The count bound matters as its own check — without it a 256 KB frame
// would still allocate ~21,000 objects before per-entry validation ran, and the
// point of a cap is to reject BEFORE doing the work (§12.9: bounding the item is
// not bounding the collection).
//
// The bytes themselves are always in range (each color channel IS a byte), but
// an idx can still be out of range or misaligned — that is left to
// validateInstruction, the single fan-in gate every instruction already passes.
export function decodePatchEntries(payload: Uint8Array): PatchEntry[] | null {
  if (payload.length % BYTES_PER_ENTRY !== 0) {
    return null
  }
  const count = payload.length / BYTES_PER_ENTRY
  if (count > MAX_PATCH_ENTRIES) {
    return null
  }

  // Indexing `payload` directly already honours its byteOffset — a Uint8Array is
  // a view, and payload[k] reads relative to the view's own start — so unlike the
  // old DataView path there is no separate offset to thread through.
  const entries: PatchEntry[] = new Array(count)
  let offset = 0
  for (let i = 0; i < count; i += 1) {
    // Reassemble the u24 pixel index, then `<< 2` back to the byte offset the
    // rest of the code works in. The result is always a multiple of 4, so a
    // misaligned offset cannot come off the wire.
    const pixel =
      (payload[offset] << 16) | (payload[offset + 1] << 8) | payload[offset + 2]
    entries[i] = {
      idx: pixel << 2,
      from: {
        r: payload[offset + 3],
        g: payload[offset + 4],
        b: payload[offset + 5],
        a: payload[offset + 6],
      },
      to: {
        r: payload[offset + 7],
        g: payload[offset + 8],
        b: payload[offset + 9],
        a: payload[offset + 10],
      },
    }
    offset += BYTES_PER_ENTRY
  }
  return entries
}
//#endregion

//#region Frame assembly
// Builds the binary frame a client sends for a patch draw: the ordinary draw
// message as the JSON header (minus the bulky entries) with the packed entries
// as the payload. Reuses the snapshot envelope, so there is one binary frame
// format on the wire, not two.
export function encodePatchDrawFrame(
  roomId: string,
  instruction: PatchInstruction,
): Uint8Array {
  const { entries, ...instructionHeader } = instruction
  return encodeBinaryFrame(
    { type: "draw", roomId, instruction: instructionHeader },
    encodePatchEntries(entries),
  )
}

// The server side: reconstructs a candidate client message from a binary frame,
// or null if the frame is not a well-formed patch draw. The RESULT is still run
// through isValidClientMessage by the caller — this only rebuilds the shape a
// patch draw would have had if it had arrived as JSON, so exactly one validation
// path guards both transports.
export function decodePatchDrawFrame(
  raw: ArrayBuffer | Uint8Array,
): unknown | null {
  const frame = decodeBinaryFrame(raw)
  if (frame === null) {
    return null
  }

  const header = frame.header
  if (
    typeof header !== "object" ||
    header === null ||
    (header as { type?: unknown }).type !== "draw"
  ) {
    return null
  }

  const instruction = (header as { instruction?: unknown }).instruction
  if (
    typeof instruction !== "object" ||
    instruction === null ||
    (instruction as { type?: unknown }).type !== "patch"
  ) {
    return null
  }

  const entries = decodePatchEntries(frame.payload)
  if (entries === null) {
    return null
  }

  return { ...(header as object), instruction: { ...instruction, entries } }
}
//#endregion
