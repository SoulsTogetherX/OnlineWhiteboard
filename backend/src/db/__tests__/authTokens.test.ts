//#region Imports
import { randomUUID } from "node:crypto"

import { afterAll, beforeAll, describe, expect, it } from "vitest"

import { db } from "../pool"
import { runMigrations } from "../migrate"
import { createUser, updateEmailVerified, updatePasswordHash } from "../userRepository"
import {
  consumeAuthToken,
  createAuthToken,
  deleteAuthTokensForUserKind,
  deleteExpiredAuthTokens,
  latestAuthTokenIssuedAt,
} from "../authTokenRepository"
import { emailBlindIndex, encryptEmail, newUserId } from "@/auth/emailCrypto"
import { hashPassword } from "@/auth/password"
//#endregion

//#region Gate
// Integration: needs a real Postgres. Skips (green) without POSTGRES_PASSWORD,
// exactly like auth.test.ts — the SQL here (single-use delete-returning, the
// kind CHECK, expiry filtering) can only be proven against a real database.
const DB_CONFIGURED = Boolean(process.env.POSTGRES_PASSWORD)
//#endregion

//#region Helpers
const createdIndexes: string[] = []

async function makeUser() {
  const email = `t-${randomUUID()}@example.com`
  const emailIndex = await emailBlindIndex(email)
  createdIndexes.push(emailIndex)
  const id = newUserId()
  return createUser({
    id,
    emailIndex,
    emailCiphertext: encryptEmail(email, id),
    username: "Tester",
    passwordHash: await hashPassword("a-good-password"),
    color: "#4363d8",
  })
}

const soon = () => new Date(Date.now() + 60_000)
const past = () => new Date(Date.now() - 60_000)
const hash = () => randomUUID().replace(/-/g, "")
//#endregion

//#region Tests
describe.skipIf(!DB_CONFIGURED)("auth token persistence (integration)", () => {
  beforeAll(async () => {
    await runMigrations()
  })

  afterAll(async () => {
    // Tokens cascade with their user, so deleting the users clears everything.
    for (const emailIndex of createdIndexes) {
      await db.deleteFrom("users").where("email_index", "=", emailIndex).execute()
    }
    await db.destroy()
  })

  it("redeems a valid token exactly once and returns its user", async () => {
    const user = await makeUser()
    const id = hash()
    await createAuthToken({
      tokenHash: id,
      userId: user.id,
      kind: "password_reset",
      expiresAt: soon(),
    })

    expect(await consumeAuthToken(id, "password_reset")).toBe(user.id)
    // Single-use: the row is gone, so a replay returns null.
    expect(await consumeAuthToken(id, "password_reset")).toBeNull()
  })

  it("refuses to redeem a token under the wrong kind", async () => {
    const user = await makeUser()
    const id = hash()
    await createAuthToken({
      tokenHash: id,
      userId: user.id,
      kind: "email_verify",
      expiresAt: soon(),
    })

    // A verify token must never double as a reset token, even in one table.
    expect(await consumeAuthToken(id, "password_reset")).toBeNull()
    // Still valid under its real kind (the failed redeem didn't consume it).
    expect(await consumeAuthToken(id, "email_verify")).toBe(user.id)
  })

  it("does not redeem an expired token", async () => {
    const user = await makeUser()
    const id = hash()
    await createAuthToken({
      tokenHash: id,
      userId: user.id,
      kind: "password_reset",
      expiresAt: past(),
    })
    expect(await consumeAuthToken(id, "password_reset")).toBeNull()
  })

  it("retires prior tokens of a kind and reports the latest issue time", async () => {
    const user = await makeUser()
    expect(await latestAuthTokenIssuedAt(user.id, "email_verify")).toBeNull()

    const first = hash()
    await createAuthToken({
      tokenHash: first,
      userId: user.id,
      kind: "email_verify",
      expiresAt: soon(),
    })
    expect(await latestAuthTokenIssuedAt(user.id, "email_verify")).toBeInstanceOf(
      Date,
    )

    // Issuing again invalidates the previous one of the same kind.
    await deleteAuthTokensForUserKind(user.id, "email_verify")
    expect(await consumeAuthToken(first, "email_verify")).toBeNull()
  })

  it("sweeps only expired tokens", async () => {
    const user = await makeUser()
    const live = hash()
    const dead = hash()
    await createAuthToken({
      tokenHash: live,
      userId: user.id,
      kind: "password_reset",
      expiresAt: soon(),
    })
    await createAuthToken({
      tokenHash: dead,
      userId: user.id,
      kind: "password_reset",
      expiresAt: past(),
    })

    const removed = await deleteExpiredAuthTokens()
    expect(removed).toBeGreaterThanOrEqual(1)
    // The live one survived the sweep.
    expect(await consumeAuthToken(live, "password_reset")).toBe(user.id)
  })

  it("flips email_verified and swaps the password hash", async () => {
    const user = await makeUser()
    expect(user.emailVerified).toBe(false)

    const verified = await updateEmailVerified(user.id)
    expect(verified?.emailVerified).toBe(true)

    const newHash = await hashPassword("a-different-good-password")
    expect(await updatePasswordHash(user.id, newHash)).toBe(true)
  })
})
//#endregion
