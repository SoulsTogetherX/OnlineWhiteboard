import { describe, expect, it } from "vitest"

import {
  validateEmail,
  validatePassword,
  validateUsername,
} from "../validation"

describe("validateEmail", () => {
  it("accepts and lowercases a valid address", () => {
    const r = validateEmail("Alice@Example.COM")
    expect(r).toEqual({ ok: true, value: "alice@example.com" })
  })

  it("rejects malformed and non-string input", () => {
    expect(validateEmail("not-an-email").ok).toBe(false)
    expect(validateEmail("a@b").ok).toBe(false)
    expect(validateEmail(42).ok).toBe(false)
  })
})

describe("validatePassword", () => {
  it("accepts a reasonable password", () => {
    expect(validatePassword("a-decent-passphrase").ok).toBe(true)
  })

  it("rejects too-short and too-long passwords", () => {
    expect(validatePassword("short").ok).toBe(false)
    expect(validatePassword("x".repeat(201)).ok).toBe(false)
  })

  it("rejects common passwords, case-insensitively", () => {
    expect(validatePassword("password123").ok).toBe(false)
    expect(validatePassword("PASSWORD123").ok).toBe(false)
    expect(validatePassword("whiteboard").ok).toBe(false)
  })
})

describe("validateUsername", () => {
  it("accepts and trims a valid name", () => {
    expect(validateUsername("  Bob  ")).toEqual({ ok: true, value: "Bob" })
  })

  it("rejects too-short and too-long names", () => {
    expect(validateUsername("a").ok).toBe(false)
    expect(validateUsername("x".repeat(33)).ok).toBe(false)
  })
})
