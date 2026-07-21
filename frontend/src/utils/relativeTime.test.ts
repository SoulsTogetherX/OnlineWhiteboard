import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { relativeTime } from "./relativeTime"

// A fixed "now" so the cascade is deterministic. new Date(iso) parses an
// absolute instant, so only Date.now() needs pinning.
const NOW = new Date("2026-07-20T12:00:00.000Z").getTime()
const ago = (ms: number): string => new Date(NOW - ms).toISOString()

const SECOND = 1000
const MINUTE = 60 * SECOND
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

describe("relativeTime", () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(NOW)
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it("returns empty string for an unparseable timestamp", () => {
    expect(relativeTime("not a date")).toBe("")
  })

  it("pluralises the unit except at exactly one", () => {
    expect(relativeTime(ago(1 * SECOND))).toBe("1 second ago")
    expect(relativeTime(ago(5 * SECOND))).toBe("5 seconds ago")
    expect(relativeTime(ago(1 * MINUTE))).toBe("1 minute ago")
    expect(relativeTime(ago(5 * MINUTE))).toBe("5 minutes ago")
  })

  it("cascades up through hours, days and beyond", () => {
    expect(relativeTime(ago(3 * HOUR))).toBe("3 hours ago")
    expect(relativeTime(ago(2 * DAY))).toBe("2 days ago")
    // The cascade's week divisor (4.35) makes 30 days round to "4 weeks"; 45
    // clears into months.
    expect(relativeTime(ago(45 * DAY))).toBe("1 month ago")
    expect(relativeTime(ago(400 * DAY))).toBe("1 year ago")
  })

  it("clamps a future timestamp to zero rather than going negative", () => {
    expect(relativeTime(ago(-10 * SECOND))).toBe("0 seconds ago")
  })
})
