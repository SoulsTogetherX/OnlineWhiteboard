import { describe, expect, it } from "vitest"

import { clipSegmentToCanvas } from "../helperProtocolMethods"
import { CANVAS_HEIGHT, CANVAS_WIDTH } from "../../constants/canvas"

import { DIMS } from "./testHelpers"

const MAX_X = CANVAS_WIDTH - 1 // 119
const MAX_Y = CANVAS_HEIGHT - 1 // 119

const inBounds = ([x, y]: [number, number]) =>
  x >= 0 && x <= MAX_X && y >= 0 && y <= MAX_Y

describe("clipSegmentToCanvas", () => {
  it("returns a fully-inside segment untouched", () => {
    expect(clipSegmentToCanvas([10, 10], [20, 30], DIMS)).toEqual([
      [10, 10],
      [20, 30],
    ])
  })

  it("handles a degenerate segment (a single point) inside", () => {
    expect(clipSegmentToCanvas([5, 5], [5, 5], DIMS)).toEqual([
      [5, 5],
      [5, 5],
    ])
  })

  it("rejects a single point outside", () => {
    expect(clipSegmentToCanvas([-1, 5], [-1, 5], DIMS)).toBeNull()
    expect(clipSegmentToCanvas([CANVAS_WIDTH, 5], [CANVAS_WIDTH, 5], DIMS)).toBeNull()
  })

  it("clips a horizontal run that leaves the right edge", () => {
    // THE BUG THIS FIXES: the stroke must reach x=119, not stop at the last
    // in-bounds pointer sample.
    const clipped = clipSegmentToCanvas([100, 50], [500, 50], DIMS)
    expect(clipped).toEqual([
      [100, 50],
      [MAX_X, 50],
    ])
  })

  it("clips to the true crossing point, NOT to a per-axis clamp", () => {
    // From (50,50) toward (200,60): the line leaves the canvas at x=119, where
    // y = 50 + 10*(119-50)/(200-50) = 54.6 -> 55.
    // Clamping each axis independently would wrongly give (119, 60).
    const clipped = clipSegmentToCanvas([50, 50], [200, 60], DIMS)
    expect(clipped).not.toBeNull()
    expect(clipped![1]).toEqual([MAX_X, 55])
    expect(clipped![1]).not.toEqual([MAX_X, 60])
  })

  it("clips a segment leaving the top edge (negative y)", () => {
    const clipped = clipSegmentToCanvas([60, 40], [60, -100], DIMS)
    expect(clipped).toEqual([
      [60, 40],
      [60, 0],
    ])
  })

  it("clips a segment leaving the left edge (negative x)", () => {
    const clipped = clipSegmentToCanvas([40, 60], [-100, 60], DIMS)
    expect(clipped).toEqual([
      [40, 60],
      [0, 60],
    ])
  })

  it("clips BOTH ends when the pointer re-enters from outside", () => {
    // Pointer was off the left, comes back across to off the right.
    const clipped = clipSegmentToCanvas([-50, 60], [200, 60], DIMS)
    expect(clipped).toEqual([
      [0, 60],
      [MAX_X, 60],
    ])
  })

  it("returns null when the segment misses the canvas entirely", () => {
    // Moving around beyond the right edge — nothing to draw.
    expect(clipSegmentToCanvas([200, 10], [300, 90], DIMS)).toBeNull()
    // Passing above the canvas.
    expect(clipSegmentToCanvas([-10, -10], [200, -10], DIMS)).toBeNull()
  })

  it("returns null for a diagonal that passes outside the corner", () => {
    // Heads toward the canvas but crosses beyond the top-right corner.
    expect(clipSegmentToCanvas([200, 0], [130, -80], DIMS)).toBeNull()
  })

  it("keeps a segment that only grazes a corner", () => {
    const clipped = clipSegmentToCanvas([MAX_X, MAX_Y], [200, 200], DIMS)
    expect(clipped).not.toBeNull()
    expect(clipped![0]).toEqual([MAX_X, MAX_Y])
  })

  it("always returns in-bounds endpoints — the wire protocol requires it", () => {
    const cases: Array<[[number, number], [number, number]]> = [
      [[0, 0], [999, 999]],
      [[-999, -999], [60, 60]],
      [[-5, 60], [500, 61]],
      [[60, -5], [61, 500]],
      [[119, 119], [120, 120]],
      [[-1, -1], [MAX_X + 1, MAX_Y + 1]],
    ]
    for (const [a, b] of cases) {
      const clipped = clipSegmentToCanvas(a, b, DIMS)
      if (clipped === null) {
        continue
      }
      expect(inBounds(clipped[0]), `start of ${JSON.stringify([a, b])}`).toBe(true)
      expect(inBounds(clipped[1]), `end of ${JSON.stringify([a, b])}`).toBe(true)
    }
  })

  it("rejects non-finite input rather than emitting NaN coordinates", () => {
    expect(clipSegmentToCanvas([0, 0], [NaN, 5], DIMS)).toBeNull()
    expect(clipSegmentToCanvas([0, 0], [Infinity, 5], DIMS)).toBeNull()
    expect(clipSegmentToCanvas([-Infinity, 0], [5, 5], DIMS)).toBeNull()
  })

  it("is order-independent about which end is outside", () => {
    const out = clipSegmentToCanvas([50, 50], [200, 60], DIMS)
    const back = clipSegmentToCanvas([200, 60], [50, 50], DIMS)
    expect(out).not.toBeNull()
    expect(back).not.toBeNull()
    // Same clipped span, just reported from the other end.
    expect(back![0]).toEqual(out![1])
    expect(back![1]).toEqual(out![0])
  })
})
