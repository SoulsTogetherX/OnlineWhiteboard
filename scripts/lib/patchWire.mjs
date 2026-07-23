// The patch wire format, for the probes only.
//
// This deliberately RE-IMPLEMENTS shared/utils/patchCodec.ts rather than
// importing it. The probes are run as `node scripts/*.mjs` with zero
// dependencies and no build step (see .github/workflows/ci.yml) — importing the
// TypeScript codec would drag in a loader and a compile step and lose exactly
// the property that makes the probes trustworthy: they share nothing with the
// server they are testing except the wire itself.
//
// The cost of a second implementation is drift — and it DID drift once, when the
// entry shrank from 12 bytes to 11 and this copy was left encoding the old
// layout, so a normal patch stopped round-tripping. The guard against that is
// shared/utils/__tests__/patchWire-parity.test.ts, which imports THIS file and
// the real codec and asserts they emit byte-identical output. If you change the
// format in one place, that test fails until you change it in the other.
//
// Keep this pure JS and dependency-free. If it grows a dependency, the probes'
// zero-install promise is gone and the whole reason it is separate evaporates.

// Must match shared/utils/binaryFrame.ts.
export const BINARY_FRAME_VERSION = 1

// Must match shared/utils/patchCodec.ts: a u24 PIXEL index (byte offset >> 2)
// then from-RGBA then to-RGBA.
export const BYTES_PER_ENTRY = 11

// Packs a patch's entries into the payload bytes. Mirrors encodePatchEntries.
export function packPatchEntries(entries) {
  const payload = Buffer.alloc(entries.length * BYTES_PER_ENTRY)
  entries.forEach((e, i) => {
    const o = i * BYTES_PER_ENTRY
    const pixel = e.idx >>> 2
    payload[o] = (pixel >>> 16) & 0xff
    payload[o + 1] = (pixel >>> 8) & 0xff
    payload[o + 2] = pixel & 0xff
    payload[o + 3] = e.from.r
    payload[o + 4] = e.from.g
    payload[o + 5] = e.from.b
    payload[o + 6] = e.from.a
    payload[o + 7] = e.to.r
    payload[o + 8] = e.to.g
    payload[o + 9] = e.to.b
    payload[o + 10] = e.to.a
  })
  return payload
}

// Builds the full binary frame a real client sends for a patch draw: the draw
// message minus its entries as the JSON header, the packed entries as the
// payload. Mirrors encodePatchDrawFrame + encodeBinaryFrame.
export function encodePatchFrame(roomId, instruction) {
  const { entries, ...instructionHeader } = instruction
  const payload = packPatchEntries(entries)
  const header = Buffer.from(
    JSON.stringify({ type: "draw", roomId, instruction: instructionHeader }),
    "utf8",
  )
  const frame = Buffer.alloc(3 + header.length + payload.length)
  frame[0] = BINARY_FRAME_VERSION
  frame[1] = (header.length >> 8) & 0xff
  frame[2] = header.length & 0xff
  header.copy(frame, 3)
  payload.copy(frame, 3 + header.length)
  return frame
}
