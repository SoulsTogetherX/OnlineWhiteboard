// Breached-password screening.
//
// `fetch` is stubbed throughout — a test that depends on a live third-party API
// is a test that fails when someone else has an outage.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { checkPasswordBreached } from "../breachedPassword"

const realFetch = globalThis.fetch

// SHA-1("password") = 5BAA61E4C9B93F3F0682250B6CF8331B7EE68FD8
const PASSWORD = "password"
const PREFIX = "5BAA6"
const SUFFIX = "1E4C9B93F3F0682250B6CF8331B7EE68FD8"

function stubFetch(impl: (url: string) => unknown) {
  globalThis.fetch = vi.fn(async (input: unknown) => impl(String(input))) as never
}

beforeEach(() => {
  vi.stubEnv("BREACH_CHECK_DISABLED", "")
})

afterEach(() => {
  globalThis.fetch = realFetch
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
})

describe("k-anonymity", () => {
  it("sends ONLY the 5-character hash prefix, never the password", async () => {
    let requested = ""
    stubFetch((url) => {
      requested = url
      return { ok: true, text: async () => `${SUFFIX}:42` }
    })

    await checkPasswordBreached(PASSWORD)

    expect(requested).toContain(PREFIX)

    // Assert against the PATH, not the whole URL: the host is
    // "api.pwnedpasswords.com", which contains the literal substring
    // "password", so a naive whole-URL check fails for a reason that has
    // nothing to do with leaking anything.
    const path = new URL(requested).pathname
    expect(path).not.toContain(PASSWORD)
    // The suffix is the sensitive half — it is what would identify the exact
    // password within the bucket — and must never appear anywhere in the URL.
    expect(requested).not.toContain(SUFFIX)
    // Exactly the prefix, nothing more.
    expect(path).toBe(`/range/${PREFIX}`)
  })

  it("detects a breached password from the returned suffix list", async () => {
    stubFetch(() => ({
      ok: true,
      // A realistic response: many unrelated suffixes, ours among them.
      text: async () =>
        [`0000000000000000000000000000000000A:5`, `${SUFFIX}:24230577`, `FFF:1`].join(
          "\n",
        ),
    }))

    const result = await checkPasswordBreached(PASSWORD)
    expect(result.breached).toBe(true)
    expect(result).toMatchObject({ count: 24230577 })
  })

  it("passes a password whose suffix is absent", async () => {
    stubFetch(() => ({
      ok: true,
      text: async () => `0000000000000000000000000000000000A:5\nFFFA:2`,
    }))

    const result = await checkPasswordBreached(PASSWORD)
    expect(result.breached).toBe(false)
  })

  it("ignores zero-count padding entries", async () => {
    // HIBP pads responses with random zero-count suffixes so response SIZE
    // leaks nothing. A naive parser would treat our padded suffix as a hit.
    stubFetch(() => ({
      ok: true,
      text: async () => `${SUFFIX}:0`,
    }))

    const result = await checkPasswordBreached(PASSWORD)
    expect(result.breached).toBe(false)
  })

  it("requests response padding", async () => {
    let headers: Record<string, string> = {}
    globalThis.fetch = vi.fn(async (_url: unknown, init: unknown) => {
      headers = (init as { headers: Record<string, string> }).headers
      return { ok: true, text: async () => "" }
    }) as never

    await checkPasswordBreached(PASSWORD)
    expect(headers["Add-Padding"]).toBe("true")
  })
})

describe("fails open", () => {
  // An outage at a third party must never become an outage of sign-up.
  it("allows registration when HIBP returns an error status", async () => {
    stubFetch(() => ({ ok: false, status: 503, text: async () => "" }))

    const result = await checkPasswordBreached(PASSWORD)
    expect(result.breached).toBe(false)
    expect(result).toMatchObject({ skipped: true })
  })

  it("allows registration when the request throws or times out", async () => {
    stubFetch(() => {
      throw new Error("network unreachable")
    })

    const result = await checkPasswordBreached(PASSWORD)
    expect(result.breached).toBe(false)
    expect(result).toMatchObject({ skipped: true, reason: "network unreachable" })
  })

  it("reports skipped rather than clean, so a non-check is distinguishable", async () => {
    stubFetch(() => {
      throw new Error("boom")
    })
    const result = await checkPasswordBreached(PASSWORD)
    // "not breached" and "never actually checked" must not look identical.
    expect("skipped" in result).toBe(true)
  })
})

describe("opt-out", () => {
  it("skips entirely and makes no request when disabled", async () => {
    vi.stubEnv("BREACH_CHECK_DISABLED", "1")
    const spy = vi.fn()
    globalThis.fetch = spy as never

    const result = await checkPasswordBreached(PASSWORD)
    expect(result).toMatchObject({ breached: false, skipped: true })
    expect(spy).not.toHaveBeenCalled()
  })
})
