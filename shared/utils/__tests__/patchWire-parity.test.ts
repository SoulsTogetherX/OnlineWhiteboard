// Pins the probes' hand-rolled patch encoder to the real one.
//
// scripts/lib/patchWire.mjs re-implements the patch wire format in dependency-
// free JS so the probes can run under plain `node` with no build step. A second
// implementation of a wire format drifts — and this one did once, when the entry
// shrank from 12 bytes to 11 and the probe copy was left on the old layout, so a
// normal patch stopped round-tripping through the server.
//
// This test makes that drift impossible to reintroduce silently: it encodes the
// same entries through BOTH implementations and asserts the bytes are identical.
// Change the format in one place and this fails until the other is changed too.
//
// Importing a .mjs from a .ts test is fine under vitest — the parity check is the
// entire point of tolerating the duplication, so the two files are bound here.
import { describe, expect, it } from "vitest"

// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-expect-error — plain JS probe helper, dependency-free by design, so it ships no type declarations.
import { BYTES_PER_ENTRY as PROBE_BYTES_PER_ENTRY, encodePatchFrame as probeEncodePatchFrame, packPatchEntries as probePackEntries } from "../../../scripts/lib/patchWire.mjs"

import {
  BYTES_PER_ENTRY,
  encodePatchDrawFrame,
  encodePatchEntries,
} from "../patchCodec"

import type { PatchEntry, PatchInstruction } from "../../types/drawProtocol"

const entries: PatchEntry[] = [
  { idx: 0, from: { r: 0, g: 0, b: 0, a: 0 }, to: { r: 255, g: 0, b: 0, a: 255 } },
  { idx: 4, from: { r: 1, g: 2, b: 3, a: 4 }, to: { r: 5, g: 6, b: 7, a: 8 } },
  // The top pixel of a 512x512 canvas — the offset a u16 could not have held.
  {
    idx: (512 * 512 - 1) * 4,
    from: { r: 10, g: 20, b: 30, a: 40 },
    to: { r: 200, g: 150, b: 100, a: 255 },
  },
]

describe("probe patch encoder stays byte-identical to the shared codec", () => {
  it("agrees on the per-entry byte width", () => {
    expect(PROBE_BYTES_PER_ENTRY).toBe(BYTES_PER_ENTRY)
  })

  it("packs entries to identical bytes", () => {
    const canonical = Array.from(encodePatchEntries(entries))
    const probe = Array.from(probePackEntries(entries) as Uint8Array)

    expect(probe).toEqual(canonical)
  })

  it("builds an identical full patch frame (header + payload)", () => {
    const instruction: PatchInstruction = {
      type: "patch",
      entries,
      instructionId: 7,
      sessionId: "parity",
    }

    const canonical = Array.from(encodePatchDrawFrame("room-1", instruction))
    const probe = Array.from(
      probeEncodePatchFrame("room-1", instruction) as Uint8Array,
    )

    expect(probe).toEqual(canonical)
  })
})
