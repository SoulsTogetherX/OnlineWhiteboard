// Wires the jest-dom matchers (toBeInTheDocument, toHaveAttribute, ...) into
// vitest's expect, and unmounts each test's React tree afterwards so one test's
// DOM can't leak into the next. Loaded only by the jsdom project (see
// vitest.config.ts); the node project never pays for it.
import "@testing-library/jest-dom/vitest"

import { cleanup } from "@testing-library/react"
import { afterEach } from "vitest"

afterEach(() => {
  cleanup()
})
