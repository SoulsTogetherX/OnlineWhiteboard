import { describe, expect, it } from "vitest"

import { handleDrawPatchInstruction } from "../handlePatchProtocol"
import { getIdxFromVec } from "../helperProtocolMethods"

import { BASE, BLUE, GREEN, RED, TRANSPARENT, getPixel, makeCanvas, setPixel } from "./testHelpers"

import type { PatchEntry, PatchInstruction } from "../../types/drawProtocol"

const patch = (entries: PatchEntry[]): PatchInstruction => ({
  type: "patch",
  entries,
  ...BASE,
})

describe("handleDrawPatchInstruction — compare-and-swap", () => {
  it("applies an entry when the pixel still holds the expected `from` color", () => {
    const pixels = makeCanvas()
    setPixel(pixels, 1, 1, RED)
    const idx = getIdxFromVec([1, 1])

    const applied = handleDrawPatchInstruction(
      pixels,
      patch([{ idx, from: RED, to: BLUE }]),
    )

    expect(getPixel(pixels, 1, 1)).toEqual(BLUE)
    expect(applied).toHaveLength(1)
  })

  it("SKIPS an entry when someone else has changed the pixel since", () => {
    // This is the whole point of the design: another client painted GREEN over
    // the pixel this undo expected to find RED at. Undoing must not clobber it.
    const pixels = makeCanvas()
    setPixel(pixels, 1, 1, GREEN)
    const idx = getIdxFromVec([1, 1])

    const applied = handleDrawPatchInstruction(
      pixels,
      patch([{ idx, from: RED, to: BLUE }]),
    )

    expect(getPixel(pixels, 1, 1)).toEqual(GREEN)
    expect(applied).toHaveLength(0)
  })

  it("returns only the subset that actually applied", () => {
    const pixels = makeCanvas()
    setPixel(pixels, 0, 0, RED) // matches -> will apply
    setPixel(pixels, 1, 0, GREEN) // does not match -> will be skipped
    setPixel(pixels, 2, 0, RED) // matches -> will apply

    const entries: PatchEntry[] = [
      { idx: getIdxFromVec([0, 0]), from: RED, to: BLUE },
      { idx: getIdxFromVec([1, 0]), from: RED, to: BLUE },
      { idx: getIdxFromVec([2, 0]), from: RED, to: BLUE },
    ]

    const applied = handleDrawPatchInstruction(pixels, patch(entries))

    expect(applied).toEqual([entries[0], entries[2]])
    expect(getPixel(pixels, 0, 0)).toEqual(BLUE)
    expect(getPixel(pixels, 1, 0)).toEqual(GREEN) // preserved
    expect(getPixel(pixels, 2, 0)).toEqual(BLUE)
  })

  it("compares every channel, including alpha", () => {
    const pixels = makeCanvas()
    // Same RGB as RED but transparent — must NOT be treated as equal.
    setPixel(pixels, 3, 3, { r: 255, g: 0, b: 0, a: 0 })

    const applied = handleDrawPatchInstruction(
      pixels,
      patch([{ idx: getIdxFromVec([3, 3]), from: RED, to: BLUE }]),
    )

    expect(applied).toHaveLength(0)
    expect(getPixel(pixels, 3, 3)).toEqual({ r: 255, g: 0, b: 0, a: 0 })
  })

  it("round-trips: applying a patch then its reverse restores the original", () => {
    const pixels = makeCanvas()
    setPixel(pixels, 5, 5, RED)
    const idx = getIdxFromVec([5, 5])

    handleDrawPatchInstruction(pixels, patch([{ idx, from: RED, to: BLUE }]))
    // The reverse patch is what useUndoRedo.reversed() builds.
    handleDrawPatchInstruction(pixels, patch([{ idx, from: BLUE, to: RED }]))

    expect(getPixel(pixels, 5, 5)).toEqual(RED)
  })

  it("can undo back to transparent", () => {
    const pixels = makeCanvas()
    const idx = getIdxFromVec([6, 6])
    setPixel(pixels, 6, 6, RED)

    const applied = handleDrawPatchInstruction(
      pixels,
      patch([{ idx, from: RED, to: TRANSPARENT }]),
    )

    expect(applied).toHaveLength(1)
    expect(getPixel(pixels, 6, 6)).toEqual(TRANSPARENT)
  })

  it('applies unconditionally in "replay" mode, ignoring the `from` color', () => {
    // Replay means somebody else already ran the compare-and-swap. Re-running it
    // is what let a client skip a write the server had made (see PatchApplyMode
    // in handleCanvasProtocol.ts).
    const pixels = makeCanvas()
    setPixel(pixels, 1, 1, GREEN) // NOT the `from` the entry expects
    const idx = getIdxFromVec([1, 1])

    const applied = handleDrawPatchInstruction(
      pixels,
      patch([{ idx, from: RED, to: BLUE }]),
      "replay",
    )

    expect(getPixel(pixels, 1, 1)).toEqual(BLUE)
    expect(applied).toHaveLength(1)
  })

  it('reports every entry as applied in "replay" mode', () => {
    // The return value feeds the undo/redo stacks and the "partially applied"
    // notice. In replay nothing is ever dropped, so it must report all of them.
    const pixels = makeCanvas()
    const entries: PatchEntry[] = [
      { idx: getIdxFromVec([0, 0]), from: RED, to: BLUE },
      { idx: getIdxFromVec([1, 0]), from: RED, to: GREEN },
    ]

    const applied = handleDrawPatchInstruction(pixels, patch(entries), "replay")

    expect(applied).toEqual(entries)
    expect(getPixel(pixels, 0, 0)).toEqual(BLUE)
    expect(getPixel(pixels, 1, 0)).toEqual(GREEN)
  })

  it('defaults to "decide" when no mode is given', () => {
    // A bare call means "I am the one deciding". Pinned because the default is
    // what every existing caller relies on, and flipping it would silently turn
    // the server into a replayer that never rejects a stale undo.
    const pixels = makeCanvas()
    setPixel(pixels, 1, 1, GREEN)

    const applied = handleDrawPatchInstruction(
      pixels,
      patch([{ idx: getIdxFromVec([1, 1]), from: RED, to: BLUE }]),
    )

    expect(applied).toHaveLength(0)
    expect(getPixel(pixels, 1, 1)).toEqual(GREEN)
  })

  it("handles an empty entry list without touching the canvas", () => {
    const pixels = makeCanvas()
    setPixel(pixels, 1, 1, RED)

    const applied = handleDrawPatchInstruction(pixels, patch([]))

    expect(applied).toEqual([])
    expect(getPixel(pixels, 1, 1)).toEqual(RED)
  })
})
