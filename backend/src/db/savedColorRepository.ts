//#region Imports
import { db } from "./pool"
//#endregion

//#region Constants
// Cap per user. A palette is a shortlist, not a history — past this, the oldest
// swatch is dropped when a new one is added.
const MAX_SAVED_COLORS = 24
//#endregion

//#region Repository
export async function listSavedColors(userId: string): Promise<string[]> {
  const rows = await db
    .selectFrom("saved_colors")
    .select("color")
    .where("user_id", "=", userId)
    .orderBy("created_at", "asc")
    .execute()
  return rows.map((row) => row.color)
}

// Adds a swatch (idempotent via the PK) and enforces the cap by trimming the
// oldest rows. Returns the resulting palette.
export async function addSavedColor(
  userId: string,
  color: string,
): Promise<string[]> {
  await db
    .insertInto("saved_colors")
    .values({ user_id: userId, color })
    .onConflict((oc) => oc.columns(["user_id", "color"]).doNothing())
    .execute()

  const colors = await listSavedColors(userId)
  if (colors.length > MAX_SAVED_COLORS) {
    const overflow = colors.slice(0, colors.length - MAX_SAVED_COLORS)
    await db
      .deleteFrom("saved_colors")
      .where("user_id", "=", userId)
      .where("color", "in", overflow)
      .execute()
    return colors.slice(colors.length - MAX_SAVED_COLORS)
  }
  return colors
}

export async function removeSavedColor(
  userId: string,
  color: string,
): Promise<string[]> {
  await db
    .deleteFrom("saved_colors")
    .where("user_id", "=", userId)
    .where("color", "=", color)
    .execute()
  return listSavedColors(userId)
}
//#endregion
