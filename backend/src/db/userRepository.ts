//#region Imports
import { db } from "./pool"
//#endregion

//#region Type Defs
export type User = {
  id: string
  email: string
  username: string
  color: string
}

// The public shape — never includes password_hash. Every read below selects
// columns explicitly so the hash can't leak into an API response by accident.
const PUBLIC_COLUMNS = ["id", "email", "username", "color"] as const
//#endregion

//#region Repository
export async function createUser(input: {
  email: string
  username: string
  passwordHash: string
  color: string
}): Promise<User> {
  const row = await db
    .insertInto("users")
    .values({
      email: input.email,
      username: input.username,
      password_hash: input.passwordHash,
      color: input.color,
    })
    .returning(PUBLIC_COLUMNS)
    .executeTakeFirstOrThrow()
  return row
}

export async function findUserByEmail(
  email: string,
): Promise<(User & { passwordHash: string }) | null> {
  // This is the ONE place password_hash is read, and only so login can verify
  // against it. It never leaves this function as anything but a comparison input.
  const row = await db
    .selectFrom("users")
    .select([...PUBLIC_COLUMNS, "password_hash"])
    .where("email", "=", email)
    .executeTakeFirst()
  if (!row) {
    return null
  }
  const { password_hash, ...user } = row
  return { ...user, passwordHash: password_hash }
}

export async function findUserById(id: string): Promise<User | null> {
  const row = await db
    .selectFrom("users")
    .select(PUBLIC_COLUMNS)
    .where("id", "=", id)
    .executeTakeFirst()
  return row ?? null
}

export async function emailExists(email: string): Promise<boolean> {
  const row = await db
    .selectFrom("users")
    .select("id")
    .where("email", "=", email)
    .executeTakeFirst()
  return Boolean(row)
}
//#endregion
