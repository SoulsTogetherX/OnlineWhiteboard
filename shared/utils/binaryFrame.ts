//#region Why this exists
// Canvas snapshots are the only bulk payload in the protocol: 57,600 bytes of
// RGBA. Sending them as base64 inside a JSON message inflated them by a third
// (57,600 B -> 76,800 chars) and cost a per-byte decode loop on the client, for
// no benefit — WebSocket frames are binary-capable and always were.
//
// The envelope keeps the JSON protocol intact rather than replacing it. A frame
// is a small JSON HEADER — the ordinary ServerSocketMessage, minus its pixels —
// followed by the raw payload bytes:
//
//   [0]      u8   version
//   [1..2]   u16  header length, big-endian
//   [3..n]   UTF-8 JSON header
//   [n..]    payload bytes
//
// So the client dispatches a binary frame through the SAME switch as a text one:
// it decodes the header and hands the payload to whichever case wants it. Adding
// a bulk field to another message later needs no new format, and the header is
// JSON so it extends for free — which is how compression arrives, as a field
// rather than a second frame layout.
//
// Header length is u16 (max 65,535). That is generous for a snapshot header and
// deliberately NOT enough for playback's step list, which is why playback still
// travels as text; see socketProtocol.ts.
//
// Deliberately environment-neutral: DataView, TextEncoder and TextDecoder are
// standard in both Node 22 and every target browser, so one implementation
// serves the server, the client and the tests. That is the same reason the draw
// algorithms live in shared/ — an encoder and a decoder that can disagree are
// two implementations of one contract.
//#endregion

//#region Constants
// Bumped only for an INCOMPATIBLE layout change. A decoder that sees an unknown
// version drops the frame rather than guessing at its meaning.
export const BINARY_FRAME_VERSION = 1

// version(1) + headerLength(2)
const PREFIX_BYTES = 3

// A header is small, structured metadata. The cap exists so a malformed or
// hostile length field cannot make the decoder allocate or scan wildly; it is
// bounded by the u16 the field is stored in anyway, and stated here so the
// intent survives if the field ever widens.
const MAX_HEADER_BYTES = 0xffff
//#endregion

//#region Encode
export function encodeBinaryFrame(
  header: object,
  payload: Uint8Array,
): Uint8Array {
  const headerBytes = new TextEncoder().encode(JSON.stringify(header))
  if (headerBytes.length > MAX_HEADER_BYTES) {
    throw new Error(
      `binary frame header is ${headerBytes.length} bytes, max ${MAX_HEADER_BYTES}`,
    )
  }

  const frame = new Uint8Array(PREFIX_BYTES + headerBytes.length + payload.length)
  const view = new DataView(frame.buffer)
  view.setUint8(0, BINARY_FRAME_VERSION)
  view.setUint16(1, headerBytes.length)
  frame.set(headerBytes, PREFIX_BYTES)
  frame.set(payload, PREFIX_BYTES + headerBytes.length)
  return frame
}
//#endregion

//#region Decode
export type BinaryFrame = {
  header: unknown
  payload: Uint8Array
}

// Returns null for anything that is not a well-formed frame of a version we
// understand. Callers treat null as "drop it", exactly as they treat a failed
// JSON.parse — a truncated or unknown frame must not become a half-applied
// canvas.
export function decodeBinaryFrame(
  buffer: ArrayBuffer | Uint8Array,
): BinaryFrame | null {
  const bytes =
    buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer)

  if (bytes.length < PREFIX_BYTES) {
    return null
  }

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  if (view.getUint8(0) !== BINARY_FRAME_VERSION) {
    return null
  }

  const headerLength = view.getUint16(1)
  const payloadStart = PREFIX_BYTES + headerLength
  // Not `>`: a header that claims to run past the end of the frame is
  // truncated, and reading it would silently produce a shorter header than the
  // sender wrote.
  if (payloadStart > bytes.length) {
    return null
  }

  let header: unknown
  try {
    header = JSON.parse(
      new TextDecoder().decode(bytes.subarray(PREFIX_BYTES, payloadStart)),
    )
  } catch {
    return null
  }

  // subarray, not slice: a view over the same memory, no copy of ~57KB. Callers
  // that retain it past the frame's lifetime must copy.
  return { header, payload: bytes.subarray(payloadStart) }
}
//#endregion
