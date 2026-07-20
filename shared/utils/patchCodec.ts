//#region Why this exists
// Packs a patch instruction's entries into bytes for the wire.
//
// A patch is the one client->server message that can be huge. Undoing a
// full-canvas bucket fill is one entry per pixel — 14,400 of them — and as JSON
// each entry is `{"idx":57596,"from":{"r":0,"g":0,"b":0,"a":0},"to":{...}}`,
// about a hundred bytes. That is ~1.4 MB for a single undo, which is the ONLY
// reason maxPayload had to be set as high as 4 MiB (§1.1 in the phase notes):
// the ceiling that stops a hostile 100 MiB frame was pinned open by one
// legitimate feature.
//
// Packed, an entry is 12 bytes flat: a u32 index and two RGBA quadruplets. The
// same 14,400-entry patch is ~173 KB, an 8x shrink, which lets maxPayload come
// down to a quarter-megabyte — a real tightening of the attack surface, paid for
// by the feature that forced it open rather than by weakening it.
//
// Unlike the snapshot COMPRESSION codec (which is split across node:zlib and the
// browser's DecompressionStream), this pair is symmetric and environment-neutral
// — plain DataView on both sides — so it lives in shared/ like the draw
// algorithms, one implementation the server and client cannot drift apart on.
//
// u32 for the index, not u16, on purpose: a u16 tops out at 65,535 but the index
// is a BYTE offset (pixel * 4), so today's 120x120 canvas already reaches 57,596
// and Phase 4's larger canvases would overflow a u16 outright. Four bytes costs
// nothing next to the eight for the colors and means the format never has to
// change when the canvas grows.
//#endregion

//#region Imports
import { MAX_PATCH_ENTRIES } from "../constants/canvas"
import { decodeBinaryFrame, encodeBinaryFrame } from "./binaryFrame"

import type { PatchEntry, PatchInstruction } from "../types/drawProtocol"
//#endregion

//#region Constants
// u32 idx (4) + RGBA from (4) + RGBA to (4).
const BYTES_PER_ENTRY = 12
//#endregion

//#region Entry packing
export function encodePatchEntries(entries: PatchEntry[]): Uint8Array {
  const bytes = new Uint8Array(entries.length * BYTES_PER_ENTRY)
  const view = new DataView(bytes.buffer)

  let offset = 0
  for (const entry of entries) {
    view.setUint32(offset, entry.idx)
    bytes[offset + 4] = entry.from.r
    bytes[offset + 5] = entry.from.g
    bytes[offset + 6] = entry.from.b
    bytes[offset + 7] = entry.from.a
    bytes[offset + 8] = entry.to.r
    bytes[offset + 9] = entry.to.g
    bytes[offset + 10] = entry.to.b
    bytes[offset + 11] = entry.to.a
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

  // Honour byteOffset: a decoded frame payload is a subarray view over a larger
  // buffer, so the DataView must start where the payload does, not at byte 0.
  const view = new DataView(
    payload.buffer,
    payload.byteOffset,
    payload.byteLength,
  )

  const entries: PatchEntry[] = new Array(count)
  let offset = 0
  for (let i = 0; i < count; i += 1) {
    entries[i] = {
      idx: view.getUint32(offset),
      from: {
        r: payload[offset + 4],
        g: payload[offset + 5],
        b: payload[offset + 6],
        a: payload[offset + 7],
      },
      to: {
        r: payload[offset + 8],
        g: payload[offset + 9],
        b: payload[offset + 10],
        a: payload[offset + 11],
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
