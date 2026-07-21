import { describe, expect, it } from "vitest"

import { computeCheckpointMarks } from "./marks"

import type { CheckpointInfo, PlaybackStep } from "@shared/types/socketProtocol"

// The helper only reads `.revision`, so the instruction is irrelevant here.
const step = (revision: number) => ({ revision }) as unknown as PlaybackStep
const cp = (id: string, revision: number): CheckpointInfo => ({
  id,
  name: id,
  revision,
  createdAt: "2026-01-01T00:00:00.000Z",
})

describe("computeCheckpointMarks", () => {
  const steps = [1, 2, 3, 4, 5, 6].map(step) // revisions 1..6

  it("places a checkpoint at the count of steps at or below its revision", () => {
    expect(computeCheckpointMarks(steps, [cp("a", 3)])).toEqual([
      { id: "a", name: "a", step: 3 },
    ])
  })

  it("clamps a checkpoint at or after the last step to the end", () => {
    expect(computeCheckpointMarks(steps, [cp("z", 99)])).toEqual([
      { id: "z", name: "z", step: 6 },
    ])
  })

  it("drops a checkpoint at or before the base (position 0)", () => {
    expect(computeCheckpointMarks(steps, [cp("base", 0)])).toEqual([])
  })

  it("lands on the nearest retained frame when the exact revision was decimated", () => {
    // Decimated steps keep only revisions [1, 3, 6]; a checkpoint at revision 4
    // has two retained steps (1, 3) at or below it → position 2.
    const sparse = [1, 3, 6].map(step)
    expect(computeCheckpointMarks(sparse, [cp("c", 4)])).toEqual([
      { id: "c", name: "c", step: 2 },
    ])
  })

  it("returns marks sorted by scrub position", () => {
    const marks = computeCheckpointMarks(steps, [cp("late", 5), cp("early", 2)])
    expect(marks.map((m) => m.step)).toEqual([2, 5])
  })
})
