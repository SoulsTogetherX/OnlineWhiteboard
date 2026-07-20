//#region Imports
import { randomUUID } from "node:crypto"

import { afterAll, beforeAll, describe, expect, it } from "vitest"

import { db } from "../pool"
import { runMigrations } from "../migrate"
import {
  createUser,
  emailIndexExists,
  findEmailCiphertext,
  findUserByEmailIndex,
  findUserById,
} from "../userRepository"
import {
  decryptEmail,
  emailBlindIndex,
  encryptEmail,
  newUserId,
} from "@/auth/emailCrypto"
import { deleteExpiredSessions } from "../sessionRepository"
import { hashPassword } from "@/auth/password"
import {
  createSessionForUser,
  destroySession,
  resolveSessionUser,
} from "@/auth/session"
//#endregion

//#region Gate
const DB_CONFIGURED = Boolean(process.env.POSTGRES_PASSWORD)
//#endregion

//#region Helpers
const createdIndexes: string[] = []
const freshEmail = (): string => `u-${randomUUID()}@example.com`

// Mirrors what the register route does: index the address, generate the id
// FIRST (it is the AAD), then encrypt against it.
async function makeUser(email = freshEmail()) {
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
//#endregion

//#region Tests
describe.skipIf(!DB_CONFIGURED)("auth persistence (integration)", () => {
  beforeAll(async () => {
    await runMigrations()
  })

  afterAll(async () => {
    for (const emailIndex of createdIndexes) {
      await db.deleteFrom("users").where("email_index", "=", emailIndex).execute()
    }
    await db.destroy()
  })

  it("creates a user and never returns the password hash from public reads", async () => {
    const user = await makeUser()

    expect(user.id).toBeTruthy()
    expect(user.color).toBe("#4363d8")
    // The public User type has no passwordHash field; assert at runtime too.
    expect((user as Record<string, unknown>).passwordHash).toBeUndefined()
    expect((user as Record<string, unknown>).password_hash).toBeUndefined()

    const byId = await findUserById(user.id)
    expect(byId?.username).toBe("Tester")
    expect((byId as Record<string, unknown>)?.password_hash).toBeUndefined()
    // The public shape must not carry an address in any form.
    expect((byId as Record<string, unknown>)?.email).toBeUndefined()
    expect((byId as Record<string, unknown>)?.email_ciphertext).toBeUndefined()
  })

  it("exposes the hash ONLY through the blind-index lookup, for login to verify", async () => {
    const email = freshEmail()
    await makeUser(email)
    const record = await findUserByEmailIndex(await emailBlindIndex(email))
    expect(record?.passwordHash).toMatch(/^scrypt\$/)
  })

  it("reports whether an email is taken, by index", async () => {
    const email = freshEmail()
    await makeUser(email)
    expect(await emailIndexExists(await emailBlindIndex(email))).toBe(true)
    expect(await emailIndexExists(await emailBlindIndex(freshEmail()))).toBe(
      false,
    )
  })

  it("rejects a duplicate email via the UNIQUE index on the blind index", async () => {
    // Uniqueness must survive encryption: the index is deterministic, so the
    // same address still collides even though no column holds it in plaintext.
    const email = freshEmail()
    await makeUser(email)
    await expect(makeUser(email)).rejects.toMatchObject({ code: "23505" })
  })

  it("stores NO plaintext address anywhere in the row", async () => {
    // The whole point of the design: a database dump must not contain addresses.
    const email = freshEmail()
    const user = await makeUser(email)

    const raw = await db
      .selectFrom("users")
      .selectAll()
      .where("id", "=", user.id)
      .executeTakeFirstOrThrow()

    const dumped = JSON.stringify(raw)
    expect(dumped).not.toContain(email)
    // The local-part alone would be just as identifying.
    expect(dumped).not.toContain(email.split("@")[0])
  })

  it("can still recover the address from the ciphertext (recovery path kept)", async () => {
    const email = freshEmail()
    const user = await makeUser(email)

    const ciphertext = await findEmailCiphertext(user.id)
    expect(ciphertext).toBeTruthy()
    expect(decryptEmail(ciphertext as string, user.id)).toBe(email)
  })

  it("refuses to decrypt a ciphertext moved to a different row", async () => {
    // AAD binding. Without it, an attacker with write access could swap two
    // users' ciphertexts to learn which address belongs to which account.
    const email = freshEmail()
    const user = await makeUser(email)
    const ciphertext = (await findEmailCiphertext(user.id)) as string

    expect(() => decryptEmail(ciphertext, newUserId())).toThrow()
  })

  it("creates a session and resolves it back to its user", async () => {
    const user = await makeUser()
    const { token } = await createSessionForUser(user.id)

    const resolved = await resolveSessionUser(token)
    expect(resolved?.id).toBe(user.id)
  })

  it("resolves nothing for a bad or destroyed token", async () => {
    const user = await makeUser()
    const { token } = await createSessionForUser(user.id)

    expect(await resolveSessionUser("not-a-real-token")).toBeNull()
    expect(await resolveSessionUser(undefined)).toBeNull()

    await destroySession(token)
    expect(await resolveSessionUser(token)).toBeNull()
  })

  it("deletes only expired sessions during cleanup", async () => {
    const user = await makeUser()
    const { token } = await createSessionForUser(user.id) // valid, 30 days out

    // Insert an already-expired session directly.
    await db
      .insertInto("sessions")
      .values({
        id: `expired-${randomUUID()}`,
        user_id: user.id,
        expires_at: new Date(Date.now() - 1000),
      })
      .execute()

    const removed = await deleteExpiredSessions()
    expect(removed).toBeGreaterThanOrEqual(1)
    // The live session is untouched.
    expect(await resolveSessionUser(token)).not.toBeNull()
  })

  it("cascades session deletion when a user is deleted", async () => {
    const user = await makeUser()
    const { token } = await createSessionForUser(user.id)

    await db.deleteFrom("users").where("id", "=", user.id).execute()

    expect(await resolveSessionUser(token)).toBeNull()
  })
})
//#endregion
