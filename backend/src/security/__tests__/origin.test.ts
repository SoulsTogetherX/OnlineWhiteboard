import { afterEach, describe, expect, it, vi } from "vitest"

// Unlike the other backend suites, this one needs NO database — it is a pure
// unit test of the origin allowlist, so it runs everywhere (including on a
// machine with no Postgres, where the repository suites skip themselves).
//
// origin.ts reads ALLOWED_ORIGINS/PUBLIC_SITE_URL/NODE_ENV ONCE at import time
// into module-level consts. That is the right shape for a check on the WebSocket
// upgrade hot path, but it means each case here must re-import the module under
// a fresh environment — hence vi.resetModules() plus a dynamic import.

const ORIGINAL_ENV = { ...process.env }

afterEach(() => {
  process.env = { ...ORIGINAL_ENV }
  vi.restoreAllMocks()
})

async function loadIsAllowedOrigin(overrides: {
  ALLOWED_ORIGINS?: string
  PUBLIC_SITE_URL?: string
  NODE_ENV?: string
}) {
  vi.resetModules()
  // The module logs a warning/error banner at import when unconfigured; silence
  // it so the suite output stays readable.
  vi.spyOn(console, "warn").mockImplementation(() => {})
  vi.spyOn(console, "error").mockImplementation(() => {})

  const next: NodeJS.ProcessEnv = { ...ORIGINAL_ENV }
  // Start from "unconfigured" so a case only has what it explicitly sets.
  delete next.ALLOWED_ORIGINS
  delete next.PUBLIC_SITE_URL
  Object.assign(next, overrides)
  process.env = next

  const { isAllowedOrigin } = await import("../origin")
  return isAllowedOrigin
}

describe("isAllowedOrigin", () => {
  it("allows a request with no Origin header", async () => {
    const isAllowedOrigin = await loadIsAllowedOrigin({
      ALLOWED_ORIGINS: "https://board.example",
    })
    // Non-browser clients (tests, the load harness, curl) send no Origin and
    // cannot carry a victim's cookie, so they are not a CSRF/CSWSH vector.
    expect(isAllowedOrigin(undefined)).toBe(true)
    expect(isAllowedOrigin(null)).toBe(true)
    expect(isAllowedOrigin("")).toBe(true)
  })

  it("allows origins on the allowlist and rejects others", async () => {
    const isAllowedOrigin = await loadIsAllowedOrigin({
      ALLOWED_ORIGINS: "https://board.example,https://alt.example",
    })
    expect(isAllowedOrigin("https://board.example")).toBe(true)
    expect(isAllowedOrigin("https://alt.example")).toBe(true)
    expect(isAllowedOrigin("https://evil.example")).toBe(false)
  })

  it("does not treat a lookalike origin as a match", async () => {
    const isAllowedOrigin = await loadIsAllowedOrigin({
      ALLOWED_ORIGINS: "https://board.example",
    })
    // Exact-match only: a suffix/prefix check here would be the classic
    // allowlist bypass (board.example.evil.com, evil-board.example).
    expect(isAllowedOrigin("https://board.example.evil.com")).toBe(false)
    expect(isAllowedOrigin("https://evil-board.example")).toBe(false)
    expect(isAllowedOrigin("http://board.example")).toBe(false)
  })

  it("falls back to PUBLIC_SITE_URL when ALLOWED_ORIGINS is unset", async () => {
    const isAllowedOrigin = await loadIsAllowedOrigin({
      PUBLIC_SITE_URL: "https://board.example",
    })
    expect(isAllowedOrigin("https://board.example")).toBe(true)
    expect(isAllowedOrigin("https://evil.example")).toBe(false)
  })

  it("fails OPEN when unconfigured in development", async () => {
    const isAllowedOrigin = await loadIsAllowedOrigin({
      NODE_ENV: "development",
    })
    // A fresh checkout with no ALLOWED_ORIGINS should still run locally.
    expect(isAllowedOrigin("http://localhost:5173")).toBe(true)
    expect(isAllowedOrigin("https://anything.example")).toBe(true)
  })

  it("fails CLOSED when unconfigured in production", async () => {
    const isAllowedOrigin = await loadIsAllowedOrigin({
      NODE_ENV: "production",
    })
    // The point of the change: a misconfigured production deploy must break
    // loudly rather than silently serving with CSWSH/CSRF protection disabled.
    expect(isAllowedOrigin("https://board.example")).toBe(false)
    expect(isAllowedOrigin("https://evil.example")).toBe(false)
  })

  it("still allows non-browser clients when unconfigured in production", async () => {
    const isAllowedOrigin = await loadIsAllowedOrigin({
      NODE_ENV: "production",
    })
    // Fail-closed must not break health checks and other origin-less probes.
    expect(isAllowedOrigin(undefined)).toBe(true)
  })

  it("uses the configured allowlist in production, not the fail-closed path", async () => {
    const isAllowedOrigin = await loadIsAllowedOrigin({
      NODE_ENV: "production",
      ALLOWED_ORIGINS: "https://board.example",
    })
    expect(isAllowedOrigin("https://board.example")).toBe(true)
    expect(isAllowedOrigin("https://evil.example")).toBe(false)
  })
})
