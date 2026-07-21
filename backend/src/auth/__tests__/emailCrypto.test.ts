// Email-at-rest crypto. No database needed — these are pure properties of the
// scheme, and they are the properties the whole design rests on.

import { afterEach, describe, expect, it, vi } from "vitest"

import {
  blindIndexEquals,
  decryptEmail,
  emailBlindIndex,
  encryptEmail,
  newUserId,
} from "../emailCrypto"

afterEach(() => {
  vi.unstubAllEnvs()
  vi.resetModules()
})

describe("blind index", () => {
  it("is deterministic — the same address always indexes the same", async () => {
    // This is what makes login lookup possible at all. If it were not stable,
    // nobody could ever sign in again.
    const a = await emailBlindIndex("person@example.com")
    const b = await emailBlindIndex("person@example.com")
    expect(a).toBe(b)
  })

  it("differs for different addresses", async () => {
    const a = await emailBlindIndex("person@example.com")
    const b = await emailBlindIndex("person2@example.com")
    expect(a).not.toBe(b)
  })

  it("does not contain the address it indexes", async () => {
    const index = await emailBlindIndex("person@example.com")
    expect(index).not.toContain("person")
    expect(index).not.toContain("example.com")
    expect(index).toMatch(/^[0-9a-f]{64}$/)
  })

  it("compares in constant time without leaking length mismatches", async () => {
    const a = await emailBlindIndex("person@example.com")
    expect(blindIndexEquals(a, a)).toBe(true)
    expect(blindIndexEquals(a, await emailBlindIndex("other@example.com"))).toBe(
      false,
    )
    // Different lengths must be false, not a throw from timingSafeEqual.
    expect(blindIndexEquals(a, "abcd")).toBe(false)
  })
})

describe("encryption", () => {
  it("round-trips an address for the row it belongs to", async () => {
    const id = newUserId()
    const cipher = encryptEmail("person@example.com", id)
    expect(decryptEmail(cipher, id)).toBe("person@example.com")
  })

  it("produces a different ciphertext every time (fresh IV)", () => {
    const id = newUserId()
    const a = encryptEmail("person@example.com", id)
    const b = encryptEmail("person@example.com", id)
    // Identical plaintext under a reused IV would leak equality between rows.
    expect(a).not.toBe(b)
  })

  it("does not leak the plaintext into the stored form", () => {
    const id = newUserId()
    const cipher = encryptEmail("person@example.com", id)
    expect(cipher).not.toContain("person")
    expect(cipher).not.toContain("example.com")
    expect(cipher.startsWith("v1.")).toBe(true)
  })

  it("REFUSES a ciphertext moved to another row (AAD binding)", () => {
    // Without AAD, an attacker with write access could swap two users'
    // ciphertexts and learn which address belongs to which account by seeing
    // which one still decrypts.
    const cipher = encryptEmail("person@example.com", newUserId())
    expect(() => decryptEmail(cipher, newUserId())).toThrow()
  })

  it("REFUSES a tampered ciphertext rather than returning garbage", () => {
    const id = newUserId()
    const cipher = encryptEmail("person@example.com", id)
    const parts = cipher.split(".")
    // Flip a byte in the ciphertext segment.
    const data = Buffer.from(parts[3], "base64")
    data[0] ^= 0xff
    parts[3] = data.toString("base64")
    expect(() => decryptEmail(parts.join("."), id)).toThrow()
  })

  it("rejects an unrecognised format version", () => {
    const id = newUserId()
    const cipher = encryptEmail("person@example.com", id)
    expect(() => decryptEmail(cipher.replace(/^v1\./, "v9."), id)).toThrow(
      /format/i,
    )
  })
})

describe("key handling", () => {
  it("FAILS CLOSED in production when the pepper is missing", async () => {
    // A silent dev-default fallback in production would mean every stored
    // address is readable by anyone holding this source file.
    vi.stubEnv("NODE_ENV", "production")
    vi.stubEnv("EMAIL_INDEX_PEPPER", "")
    vi.stubEnv("EMAIL_ENCRYPTION_KEY", "")
    vi.resetModules()

    const mod = await import("../emailCrypto")
    await expect(mod.emailBlindIndex("person@example.com")).rejects.toThrow(
      /EMAIL_INDEX_PEPPER/,
    )
  })

  it("FAILS CLOSED in production when the encryption key is missing", async () => {
    vi.stubEnv("NODE_ENV", "production")
    vi.stubEnv("EMAIL_INDEX_PEPPER", "a-real-pepper")
    vi.stubEnv("EMAIL_ENCRYPTION_KEY", "")
    vi.resetModules()

    const mod = await import("../emailCrypto")
    expect(() => mod.encryptEmail("person@example.com", "id")).toThrow(
      /EMAIL_ENCRYPTION_KEY/,
    )
  })

  it("rejects an encryption key of the wrong length", async () => {
    vi.stubEnv("NODE_ENV", "production")
    vi.stubEnv("EMAIL_INDEX_PEPPER", "a-real-pepper")
    // 16 bytes, not 32 — would silently be the wrong cipher strength.
    vi.stubEnv("EMAIL_ENCRYPTION_KEY", Buffer.alloc(16, 1).toString("base64"))
    vi.resetModules()

    const mod = await import("../emailCrypto")
    expect(() => mod.encryptEmail("person@example.com", "id")).toThrow(
      /32 bytes/,
    )
  })

  it("still works in development without configuration, so a clone runs", async () => {
    vi.stubEnv("NODE_ENV", "development")
    vi.stubEnv("EMAIL_INDEX_PEPPER", "")
    vi.stubEnv("EMAIL_ENCRYPTION_KEY", "")
    vi.resetModules()

    const mod = await import("../emailCrypto")
    const id = mod.newUserId()
    const cipher = mod.encryptEmail("person@example.com", id)
    expect(mod.decryptEmail(cipher, id)).toBe("person@example.com")
  })
})
