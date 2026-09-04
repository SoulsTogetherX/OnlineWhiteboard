// The pool must bound how long a new connection may take to establish. pg's
// default is unbounded; incident 002 saw a stalled connect surface as
// ETIMEDOUT only after the process was already starving. This pins the
// default and the override, without opening a connection.
import { describe, expect, it } from "vitest"

import pool from "../pool"

describe("pool configuration", () => {
  it("bounds new-connection setup time (default 5000 ms)", () => {
    const configured = Number(process.env.PG_CONNECT_TIMEOUT_MS ?? 5000)
    expect(pool.options.connectionTimeoutMillis).toBe(configured)
    expect(pool.options.connectionTimeoutMillis).toBeGreaterThan(0)
  })
})
