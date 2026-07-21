//#region Imports
import { db } from "./pool"

import { DEFAULT_CANVAS_DIMS } from "@shared/constants/canvas"
//#endregion

//#region Room Lifecycle
// Deletes rooms whose last save (rooms.updated_at) is older than `cutoff` and
// that are NOT currently loaded in memory. This is the one table that isn't
// self-pruning: a row is created for every room ever visited, and unlike the
// event log (compacted on save) or snapshots (only the latest kept), nothing
// removes rooms that were drawn in once and then abandoned.
//
// Deleting a room row is enough to clean everything: canvas_snapshots and
// draw_events both FOREIGN KEY to rooms(id) ON DELETE CASCADE, so their rows go
// with it in the same statement.
//
// `exceptRoomIds` is the set of rooms currently live in the server's memory. A
// room's updated_at only advances when a snapshot is saved, so a room that has
// been open-but-idle for months could look "stale" by timestamp while someone
// is still in it — excluding the in-memory set guarantees we never delete a
// room out from under a connected user. Returns how many rooms were removed.
export async function pruneStaleRooms(
  cutoff: Date,
  exceptRoomIds: string[],
): Promise<number> {
  let query = db.deleteFrom("rooms").where("updated_at", "<", cutoff)

  // Guard the NOT IN: an empty list would generate `id NOT IN ()`, which is a
  // SQL syntax error. With no active rooms there is simply nothing to exclude.
  if (exceptRoomIds.length > 0) {
    query = query.where("id", "not in", exceptRoomIds)
  }

  const result = await query.executeTakeFirst()
  // numDeletedRows is a bigint; the counts here are tiny, so narrowing to number
  // for logging is safe.
  return Number(result.numDeletedRows ?? 0n)
}
//#endregion

//#region Room settings
// Whether people without edit authority may draw in this room.
//
// Defaults to TRUE for a room that does not exist yet, matching the column
// default. That matters because a room row is only created on first save, so a
// brand-new room is legitimately absent here while people are already drawing
// in it — returning "locked" for an unknown room would make every new room open
// in a state nobody chose.
export async function getOpenEditing(roomId: string): Promise<boolean> {
  const row = await db
    .selectFrom("rooms")
    .select("open_editing")
    .where("id", "=", roomId)
    .executeTakeFirst()
  return row?.open_editing ?? true
}

// Persists the toggle. Upserts because the owner may flip it before the room
// has ever been saved, and the setting must survive that.
export async function setOpenEditing(
  roomId: string,
  enabled: boolean,
): Promise<void> {
  await db
    .insertInto("rooms")
    .values({
      id: roomId,
      // Default dims for the INSERT path only (a room whose setting is flipped
      // before it has ever been saved). On conflict only the setting is touched,
      // so these never overwrite a real room's dimensions, which saveCanvas owns.
      // They are the default rather than 0 so a freshly-inserted row satisfies
      // the dimension CHECK constraint.
      width: DEFAULT_CANVAS_DIMS.width,
      height: DEFAULT_CANVAS_DIMS.height,
      open_editing: enabled,
      created_at: new Date(),
      updated_at: new Date(),
    })
    .onConflict((oc) =>
      oc.column("id").doUpdateSet({ open_editing: enabled }),
    )
    .execute()
}
//#endregion
