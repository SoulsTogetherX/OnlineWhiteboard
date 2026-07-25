// Regression + case coverage for undo/redo, driven through the real hook with a
// minimal canvas mock (jsdom has no 2D context). The worst case here is the exact
// bug that shipped: a single max-size pencil stroke over the WHOLE canvas is one
// undo action with far more entries than a patch MESSAGE may carry, and applying
// it in one call was rejected by the per-message cap — so undo silently did
// nothing. These assert best (tiny), average (around the cap), and worst
// (full-canvas) all undo and redo correctly.

import { act, renderHook } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"

import useUndoRedo from "./useUndoRedo"

import { MAX_PATCH_ENTRIES_PER_MESSAGE } from "@shared/constants/canvas"

import type { PatchEntry, PatchInstruction } from "@shared/types/drawProtocol"

const ORIGINAL = { r: 0, g: 0, b: 0, a: 0 } // what was on the canvas before the stroke
const STROKE = { r: 255, g: 255, b: 255, a: 255 } // what the stroke painted

// A canvas element stub exposing only what getCanvasState/updateCanvas touch:
// width/height and a 2D context backed by one persistent RGBA buffer. Returns the
// buffer so a test can seed and inspect pixels directly.
function makeMockCanvas(width: number, height: number) {
  const buffer = new Uint8ClampedArray(width * height * 4)
  const imageData = { data: buffer, width, height } as unknown as ImageData
  const ctx = {
    getImageData: () => imageData,
    putImageData: () => {},
  } as unknown as CanvasRenderingContext2D
  const canvas = {
    width,
    height,
    getContext: () => ctx,
  } as unknown as HTMLCanvasElement
  return { canvas, buffer }
}

function setPixel(buf: Uint8ClampedArray, idx: number, c: typeof STROKE) {
  buf[idx] = c.r
  buf[idx + 1] = c.g
  buf[idx + 2] = c.b
  buf[idx + 3] = c.a
}

// The forward entries a stroke of `count` pixels would record: original -> stroke,
// one entry per distinct pixel (idx is a 4-aligned byte offset).
function strokeEntries(count: number): PatchEntry[] {
  const entries: PatchEntry[] = new Array(count)
  for (let i = 0; i < count; i += 1) {
    entries[i] = { idx: i * 4, from: ORIGINAL, to: STROKE }
  }
  return entries
}

// Renders the hook with a canvas already holding the stroke (the `count` acted
// pixels set to STROKE), ready to be undone.
function setup(canvasArea: number, count: number) {
  const size = Math.ceil(Math.sqrt(canvasArea))
  const { canvas, buffer } = makeMockCanvas(size, size)
  const entries = strokeEntries(count)
  for (const e of entries) {
    setPixel(buffer, e.idx, STROKE)
  }
  const send = vi.fn()
  const { result } = renderHook(() =>
    useUndoRedo({ current: canvas }, send),
  )
  act(() => result.current.pushAction(1, entries))
  return { result, buffer, send, count }
}

function allOriginal(buffer: Uint8ClampedArray): boolean {
  return buffer.every((b) => b === 0)
}

function actedPixelsAre(
  buffer: Uint8ClampedArray,
  count: number,
  c: typeof STROKE,
): boolean {
  for (let i = 0; i < count; i += 1) {
    const o = i * 4
    if (
      buffer[o] !== c.r ||
      buffer[o + 1] !== c.g ||
      buffer[o + 2] !== c.b ||
      buffer[o + 3] !== c.a
    ) {
      return false
    }
  }
  return true
}

// Each case names its size so a failure says which one broke.
const CAP = MAX_PATCH_ENTRIES_PER_MESSAGE
const cases: Array<{ name: string; canvasArea: number; count: number }> = [
  { name: "best case: a single-pixel stroke (1 chunk)", canvasArea: 16, count: 1 },
  { name: "average case: a stroke just under the cap (1 chunk)", canvasArea: CAP, count: CAP - 100 },
  { name: "average case: a stroke just over the cap (2 chunks)", canvasArea: CAP * 2, count: CAP + 1 },
  // The reported bug: a max-size pencil dragged across the whole 512x512 canvas.
  { name: "worst case: a full 512x512-canvas stroke (16 chunks)", canvasArea: 512 * 512, count: 512 * 512 },
]

describe("useUndoRedo — undo/redo across every patch size", () => {
  for (const c of cases) {
    it(`undoes and redoes ${c.name}`, () => {
      const { result, buffer, send, count } = setup(c.canvasArea, c.count)

      // Precondition: the stroke is present.
      expect(actedPixelsAre(buffer, count, STROKE)).toBe(true)
      expect(result.current.canUndo).toBe(true)

      // Undo: every acted pixel must revert — this is what broke when a
      // full-canvas patch exceeded the per-message cap and was rejected wholesale.
      act(() => result.current.undo())

      expect(allOriginal(buffer)).toBe(true)
      expect(result.current.canUndo).toBe(false)
      expect(result.current.canRedo).toBe(true)
      expect(result.current.notice).toBeNull() // NOT "Nothing to undo"

      // Sent once as an aggregate patch carrying every applied entry (the wire
      // layer re-chunks it); it must not be dropped or truncated.
      expect(send).toHaveBeenCalledTimes(1)
      const sent = send.mock.calls[0][0] as PatchInstruction
      expect(sent.type).toBe("patch")
      expect(sent.entries).toHaveLength(count)

      // Redo repaints exactly what was undone.
      send.mockClear()
      act(() => result.current.redo())

      expect(actedPixelsAre(buffer, count, STROKE)).toBe(true)
      expect(result.current.canRedo).toBe(false)
      expect(result.current.canUndo).toBe(true)
      expect(send).toHaveBeenCalledTimes(1)
      expect((send.mock.calls[0][0] as PatchInstruction).entries).toHaveLength(
        count,
      )
    })
  }
})
