import { describe, expect, it } from "vitest"

import { selectDecimatedSurvivors } from "../historyDecimation"

// Contiguous revisions so a survivor's VALUE equals its index — that makes even
// spacing directly checkable.
function range(n: number): number[] {
  return Array.from({ length: n }, (_, i) => i)
}

describe("selectDecimatedSurvivors", () => {
  it("returns the input unchanged when already within the cap", () => {
    const revs = [0, 3, 7, 12]
    expect(selectDecimatedSurvivors(revs, 4)).toEqual(revs)
    expect(selectDecimatedSurvivors(revs, 100)).toEqual(revs)
  })

  it("thins an over-cap span to `cap` samples, evenly spaced, ends anchored", () => {
    expect(selectDecimatedSurvivors(range(100), 10)).toEqual([
      0, 11, 22, 33, 44, 55, 66, 77, 88, 99,
    ])
  })

  it("keeps at most `cap` survivors and always the first and last", () => {
    for (const cap of [2, 5, 7, 13, 50]) {
      const survivors = selectDecimatedSurvivors(range(1000), cap)
      expect(survivors.length).toBeLessThanOrEqual(cap)
      expect(survivors[0]).toBe(0)
      expect(survivors[survivors.length - 1]).toBe(999)
      for (let i = 1; i < survivors.length; i += 1) {
        expect(survivors[i]).toBeGreaterThan(survivors[i - 1])
      }
    }
  })

  it("spaces survivors evenly — consecutive gaps differ by at most one", () => {
    const survivors = selectDecimatedSurvivors(range(1000), 7)
    const gaps = survivors.slice(1).map((r, i) => r - survivors[i])
    expect(Math.max(...gaps) - Math.min(...gaps)).toBeLessThanOrEqual(1)
  })

  it("is deterministic", () => {
    expect(selectDecimatedSurvivors(range(500), 33)).toEqual(
      selectDecimatedSurvivors(range(500), 33),
    )
  })

  it("handles degenerate caps", () => {
    // cap 1 keeps the most recent so the head is represented; cap 0 keeps none.
    expect(selectDecimatedSurvivors(range(10), 1)).toEqual([9])
    expect(selectDecimatedSurvivors(range(10), 0)).toEqual([])
  })
})
