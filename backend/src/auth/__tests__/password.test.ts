//#region Imports
import { describe, expect, it } from "vitest"

import { hashPassword, verifyPassword } from "../password"
//#endregion

//#region Tests
// No database needed — this is pure crypto, so it runs unconditionally (unlike
// the DB-gated integration suites).
describe("password hashing", () => {
  it("verifies a correct password", async () => {
    const hash = await hashPassword("correct horse battery staple")
    expect(await verifyPassword("correct horse battery staple", hash)).toBe(true)
  })

  it("rejects a wrong password", async () => {
    const hash = await hashPassword("correct horse battery staple")
    expect(await verifyPassword("Correct Horse Battery Staple", hash)).toBe(false)
    expect(await verifyPassword("", hash)).toBe(false)
  })

  it("produces a different hash each time (random salt)", async () => {
    const a = await hashPassword("same-password")
    const b = await hashPassword("same-password")
    // Different salts -> different stored strings, yet both verify.
    expect(a).not.toBe(b)
    expect(await verifyPassword("same-password", a)).toBe(true)
    expect(await verifyPassword("same-password", b)).toBe(true)
  })

  it("encodes scheme, cost, salt and hash in a self-describing format", async () => {
    const hash = await hashPassword("whatever")
    const [scheme, cost, salt, digest] = hash.split("$")
    expect(scheme).toBe("scrypt")
    expect(Number(cost)).toBeGreaterThan(0)
    expect(salt).toMatch(/^[0-9a-f]+$/)
    expect(digest).toMatch(/^[0-9a-f]+$/)
  })

  it("rejects a malformed stored hash instead of throwing", async () => {
    expect(await verifyPassword("x", "not-a-valid-hash")).toBe(false)
    expect(await verifyPassword("x", "")).toBe(false)
    expect(await verifyPassword("x", "bcrypt$1$aa$bb")).toBe(false)
  })
})
//#endregion
