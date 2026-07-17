//#region Imports
import { randomUUID } from "node:crypto"

import { afterAll, beforeAll, describe, expect, it } from "vitest"

import { db } from "../pool"
import { runMigrations } from "../migrate"
import {
  createUser,
  emailExists,
  findUserByEmail,
  findUserById,
} from "../userRepository"
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
const emails: string[] = []
const freshEmail = (): string => {
  const email = `u-${randomUUID()}@example.com`
  emails.push(email)
  return email
}

async function makeUser(email = freshEmail()) {
  return createUser({
    email,
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
    for (const email of emails) {
      await db.deleteFrom("users").where("email", "=", email).execute()
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
    expect(byId?.email).toBe(user.email)
    expect((byId as Record<string, unknown>)?.password_hash).toBeUndefined()
  })

  it("exposes the hash ONLY through findUserByEmail, for login to verify", async () => {
    const user = await makeUser()
    const record = await findUserByEmail(user.email)
    expect(record?.passwordHash).toMatch(/^scrypt\$/)
  })

  it("reports whether an email is taken", async () => {
    const user = await makeUser()
    expect(await emailExists(user.email)).toBe(true)
    expect(await emailExists(freshEmail())).toBe(false)
  })

  it("rejects a duplicate email via the UNIQUE constraint", async () => {
    const email = freshEmail()
    await makeUser(email)
    await expect(makeUser(email)).rejects.toMatchObject({ code: "23505" })
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
