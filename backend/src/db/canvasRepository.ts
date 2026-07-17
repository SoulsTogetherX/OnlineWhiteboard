//#region Imports
import { db } from "./pool"

import {
  CANVAS_BYTES,
  CANVAS_HEIGHT,
  CANVAS_WIDTH,
} from "@shared/constants/canvas"
//#endregion

//#region Type Defs
export type StoredCanvas = {
  pixels: Uint8ClampedArray
  revision: number
}
//#endregion

//#region Repository Methods
function clearCanvas(): Uint8ClampedArray {
  return new Uint8ClampedArray(CANVAS_BYTES)
}

// Loads a room's canvas from its latest checkpoint. In Stage 2 the latest
// snapshot IS the full truth; from Stage 3 on, the caller replays any
// draw_events newer than this snapshot's revision on top of it.
export async function loadCanvas(roomId: string): Promise<StoredCanvas> {
  const row = await db
    .selectFrom("canvas_snapshots")
    .select(["rgba", "revision", "width", "height"])
    .where("room_id", "=", roomId)
    .orderBy("revision", "desc")
    .limit(1)
    .executeTakeFirst()

  // No snapshot (new room) or one whose dimensions no longer match the current
  // constants — start blank. The dimension guard is why changing
  // CANVAS_WIDTH/HEIGHT silently resets every stored canvas.
  if (!row || row.width !== CANVAS_WIDTH || row.height !== CANVAS_HEIGHT) {
    return {
      pixels: clearCanvas(),
      revision: 0,
    }
  }

  return {
    pixels: new Uint8ClampedArray(row.rgba),
    revision: row.revision,
  }
}

// Writes a checkpoint AND compacts the event log. In one transaction it: ensures
// the room exists, stores the pixel buffer at this revision, keeps only the
// latest snapshot, and deletes every draw_event the new snapshot now
// supersedes. Doing all of it atomically is what makes it crash-safe — a crash
// mid-save can never leave a room without a snapshot, two snapshots both
// claiming to be current, or (the compaction hazard) events deleted before the
// snapshot that replaced them was durably committed.
export async function saveCanvas(
  roomId: string,
  pixels: Uint8ClampedArray,
  revision: number,
): Promise<void> {
  const buffer = Buffer.from(pixels)

  await db.transaction().execute(async (trx) => {
    // Upsert the room. First save creates it; later saves just advance the
    // head revision and the updated_at clock. title/created_at are left alone
    // on update so existing metadata survives.
    await trx
      .insertInto("rooms")
      .values({
        id: roomId,
        width: CANVAS_WIDTH,
        height: CANVAS_HEIGHT,
        revision,
        updated_at: new Date(),
      })
      .onConflict((oc) =>
        oc.column("id").doUpdateSet({ revision, updated_at: new Date() }),
      )
      .execute()

    // Write the snapshot at this revision. ON CONFLICT DO UPDATE covers the
    // edge case of saving twice at the same revision (e.g. a forced checkpoint
    // with no drawing in between).
    await trx
      .insertInto("canvas_snapshots")
      .values({
        room_id: roomId,
        revision,
        width: CANVAS_WIDTH,
        height: CANVAS_HEIGHT,
        rgba: buffer,
      })
      .onConflict((oc) =>
        oc.columns(["room_id", "revision"]).doUpdateSet({ rgba: buffer }),
      )
      .execute()

    // Prune superseded checkpoints — a snapshot is only a recovery shortcut, so
    // only the newest is worth keeping. Without this, every 15s save would leak
    // another full-canvas row forever.
    await trx
      .deleteFrom("canvas_snapshots")
      .where("room_id", "=", roomId)
      .where("revision", "<", revision)
      .execute()

    // COMPACTION. Every event at or below this revision is now baked into the
    // snapshot we just wrote, so it can never be needed again: recovery is
    // "latest snapshot + events with revision > snapshot.revision", and these
    // are ≤ it. Deleting them here bounds the event log to just the drawing done
    // since the last checkpoint (~one save interval) instead of growing without
    // limit. It's inside the same transaction as the snapshot write, so the log
    // is only ever trimmed once its replacement is durably committed.
    //
    // Tradeoff worth naming: this discards fine-grained history older than the
    // last snapshot. That's the right call for a whiteboard (bounded storage
    // beats server-side infinite undo); a system that wanted time-travel would
    // keep these rows and snapshot without pruning.
    await trx
      .deleteFrom("draw_events")
      .where("room_id", "=", roomId)
      .where("revision", "<=", revision)
      .execute()
  })
}
//#endregion
