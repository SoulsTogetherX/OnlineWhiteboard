import { describe, expect, it } from "vitest"

import {
  clamp,
  coalesceRecording,
  getDirectColor,
  getDrawerMethod,
  getIdxFromVec,
  getLookAtMethod,
  getToolColor,
  withRecording,
} from "../helperProtocolMethods"
import { DEFAULT_COLOR } from "../../constants/canvas"

import { BLUE, DIMS, RED, makeCanvas } from "./testHelpers"

import type { PatchEntry } from "../../types/drawProtocol"
import type { ColorPalette } from "../../types/primitive"

describe("clamp", () => {
  it("passes through a value already in range", () => {
    expect(clamp(5, 0, 10)).toBe(5)
  })

  it("clamps below the minimum and above the maximum", () => {
    expect(clamp(-3, 0, 10)).toBe(0)
    expect(clamp(99, 0, 10)).toBe(10)
  })

  it("returns the boundaries themselves unchanged", () => {
    expect(clamp(0, 0, 10)).toBe(0)
    expect(clamp(10, 0, 10)).toBe(10)
  })
})

describe("getIdxFromVec", () => {
  it("maps the origin to byte 0", () => {
    expect(getIdxFromVec([0, 0], DIMS)).toBe(0)
  })

  it("advances 4 bytes per pixel along x (RGBA stride)", () => {
    expect(getIdxFromVec([1, 0], DIMS)).toBe(4)
    expect(getIdxFromVec([2, 0], DIMS)).toBe(8)
  })

  it("advances a full row (WIDTH * 4 bytes) per unit of y", () => {
    expect(getIdxFromVec([0, 1], DIMS)).toBe(DIMS.width * 4)
    expect(getIdxFromVec([3, 2], DIMS)).toBe((2 * DIMS.width + 3) * 4)
  })
})

describe("getLookAtMethod / getDrawerMethod", () => {
  it("round-trips a color through the buffer", () => {
    const pixels = makeCanvas()
    const write = getDrawerMethod("pencil", pixels)
    const read = getLookAtMethod("pencil", pixels)

    write(getIdxFromVec([4, 7], DIMS), RED)

    expect(read(getIdxFromVec([4, 7], DIMS))).toEqual(RED)
  })

  it("reads an untouched pixel as fully transparent", () => {
    const pixels = makeCanvas()
    const read = getLookAtMethod("pencil", pixels)

    expect(read(getIdxFromVec([0, 0], DIMS))).toEqual({ r: 0, g: 0, b: 0, a: 0 })
  })
})

describe("coalesceRecording", () => {
  // Why this exists: withRecording appends one entry per WRITE, and a brush
  // rewrites the same pixels on every pointermove. A long stroke therefore
  // records far more entries than the canvas has pixels — and a patch is
  // validated against `entries.length <= width * height`, so the undo for a big
  // stroke was rejected outright and undo silently did nothing.
  //
  // Coalescing to one entry per pixel is not just a size trick, it is the
  // correct undo semantics: restore the colour the pixel had BEFORE the gesture
  // (its first `from`) and treat the gesture's net effect as its last `to`.
  const at = (x: number, y: number): number => getIdxFromVec([x, y], DIMS)

  it("keeps one entry per pixel: the first `from` and the last `to`", () => {
    const a = at(1, 1)

    expect(
      coalesceRecording([
        { idx: a, from: DEFAULT_COLOR, to: RED },
        { idx: a, from: RED, to: BLUE },
      ]),
    ).toEqual([{ idx: a, from: DEFAULT_COLOR, to: BLUE }])
  })

  it("never exceeds one entry per touched pixel, however many writes landed", () => {
    const a = at(1, 1)
    const b = at(2, 2)
    const many: PatchEntry[] = [
      { idx: a, from: DEFAULT_COLOR, to: RED },
      { idx: b, from: DEFAULT_COLOR, to: BLUE },
    ]
    for (let i = 0; i < 500; i += 1) {
      many.push({ idx: a, from: RED, to: RED })
      many.push({ idx: b, from: BLUE, to: BLUE })
    }

    expect(coalesceRecording(many)).toHaveLength(2)
  })

  it("drops pixels the gesture left the colour it found them", () => {
    // Drawing red over red changes nothing, so there is nothing to undo — and
    // an entry whose `from` equals its `to` is a no-op the server would log and
    // broadcast for no reason.
    const a = at(1, 1)
    const b = at(2, 2)

    expect(
      coalesceRecording([
        { idx: a, from: RED, to: RED },
        { idx: b, from: DEFAULT_COLOR, to: BLUE },
      ]),
    ).toEqual([{ idx: b, from: DEFAULT_COLOR, to: BLUE }])
  })

  it("drops a pixel that was changed and then changed back", () => {
    const a = at(1, 1)

    expect(
      coalesceRecording([
        { idx: a, from: DEFAULT_COLOR, to: RED },
        { idx: a, from: RED, to: DEFAULT_COLOR },
      ]),
    ).toEqual([])
  })

  it("preserves first-touch order", () => {
    const a = at(1, 1)
    const b = at(2, 2)

    expect(
      coalesceRecording([
        { idx: b, from: DEFAULT_COLOR, to: BLUE },
        { idx: a, from: DEFAULT_COLOR, to: RED },
        { idx: b, from: BLUE, to: RED },
      ]).map((entry) => entry.idx),
    ).toEqual([b, a])
  })
})

describe("withRecording", () => {
  // This wrapper is what makes undo free: every pixel write also records what
  // was there beforehand, off the same loop that paints. If this breaks, undo
  // silently records the wrong "from" and every CAS patch fails to apply.
  it("records the previous color as `from` and the new color as `to`", () => {
    const pixels = makeCanvas()
    const sink: PatchEntry[] = []
    const read = getLookAtMethod("pencil", pixels)
    const write = withRecording(read, getDrawerMethod("pencil", pixels), sink)

    write(getIdxFromVec([1, 1], DIMS), RED)

    expect(sink).toEqual([
      { idx: getIdxFromVec([1, 1], DIMS), from: { r: 0, g: 0, b: 0, a: 0 }, to: RED },
    ])
  })

  it("still performs the underlying write", () => {
    const pixels = makeCanvas()
    const sink: PatchEntry[] = []
    const read = getLookAtMethod("pencil", pixels)
    const write = withRecording(read, getDrawerMethod("pencil", pixels), sink)

    write(getIdxFromVec([1, 1], DIMS), RED)

    expect(read(getIdxFromVec([1, 1], DIMS))).toEqual(RED)
  })

  it("records `from` as the value at the time of the write, not the original", () => {
    const pixels = makeCanvas()
    const sink: PatchEntry[] = []
    const read = getLookAtMethod("pencil", pixels)
    const write = withRecording(read, getDrawerMethod("pencil", pixels), sink)
    const idx = getIdxFromVec([2, 2], DIMS)

    write(idx, RED)
    write(idx, BLUE)

    expect(sink[1]).toEqual({ idx, from: RED, to: BLUE })
  })
})

describe("getToolColor", () => {
  it("forces the eraser to the transparent default regardless of palette", () => {
    expect(getToolColor("eraser", RED)).toEqual(DEFAULT_COLOR)
  })

  it("passes the chosen color through for pencil and bucket", () => {
    expect(getToolColor("pencil", RED)).toEqual(RED)
    expect(getToolColor("bucket", BLUE)).toEqual(BLUE)
  })
})

describe("getDirectColor", () => {
  const palette: ColorPalette = { primary: RED, secondary: BLUE }
  const asEvent = (init: Partial<PointerEvent>) => init as PointerEvent

  it("uses the primary color for a left click", () => {
    expect(
      getDirectColor(palette, asEvent({ pointerType: "mouse", button: 0, buttons: 1 })),
    ).toEqual(RED)
  })

  it("uses the secondary color for a right click", () => {
    expect(
      getDirectColor(palette, asEvent({ pointerType: "mouse", button: 2, buttons: 2 })),
    ).toEqual(BLUE)
  })

  it("detects a held right button via the buttons bitmask", () => {
    // During a drag `button` is -1/0 and only `buttons` carries the state.
    expect(
      getDirectColor(palette, asEvent({ pointerType: "mouse", button: -1, buttons: 2 })),
    ).toEqual(BLUE)
  })

  it("always uses the primary color for touch and pen — they have no right button", () => {
    expect(
      getDirectColor(palette, asEvent({ pointerType: "touch", button: 2, buttons: 2 })),
    ).toEqual(RED)
    expect(
      getDirectColor(palette, asEvent({ pointerType: "pen", button: 2, buttons: 2 })),
    ).toEqual(RED)
  })
})
