//#region Imports
import { db } from "./pool"
import { packPixels, unpackPixels } from "./pixelStorage"

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

  // Stored gzipped. An unreadable snapshot degrades to a blank canvas rather
  // than throwing, exactly as the dimension mismatch above does — the room still
  // opens, and any draw_events past revision 0 still replay on top of it.
  const pixels = unpackPixels(row.rgba)
  if (pixels === null) {
    console.error(
      `canvas snapshot for room "${roomId}" at revision ${row.revision} could ` +
        `not be decompressed (${row.rgba.length} stored bytes); starting blank`,
    )
    return {
      pixels: clearCanvas(),
      revision: 0,
    }
  }

  return {
    pixels,
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
// `retainEventsAfter` is the compaction floor for the event log: events with a
// revision GREATER than it are kept even though the snapshot supersedes them.
// The room manager passes the oldest checkpoint's revision here, which is what
// lets history be replayed forward from any checkpoint. null (no checkpoints) =
// prune everything the snapshot covers, the original bounded behaviour.
export async function saveCanvas(
  roomId: string,
  pixels: Uint8ClampedArray,
  revision: number,
  retainEventsAfter: number | null = null,
): Promise<void> {
  // Gzipped for storage — see pixelStorage.ts. Captured before the transaction
  // so the compressed bytes match the revision being written, even though live
  // draws keep mutating `pixels` underneath.
  const buffer = packPixels(pixels)

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

    // COMPACTION. Every event at or below the snapshot revision is baked into
    // the snapshot, so recovery ("latest snapshot + events after it") never needs
    // them. Normally we delete all of them, bounding the log.
    //
    // BUT for time-travel we keep the events newer than the oldest checkpoint, so
    // history can be replayed forward from that checkpoint. The prune ceiling is
    // therefore min(revision, oldest-checkpoint-revision): with no checkpoints it
    // stays `revision` (fully bounded); with checkpoints it drops to the oldest
    // one, retaining the events between it and now. Storage is then bounded by
    // how far back the oldest checkpoint is — which an editor controls by
    // deleting old checkpoints. Atomic with the snapshot write, as before.
    const pruneCeiling =
      retainEventsAfter === null
        ? revision
        : Math.min(revision, retainEventsAfter)
    await trx
      .deleteFrom("draw_events")
      .where("room_id", "=", roomId)
      .where("revision", "<=", pruneCeiling)
      .execute()
  })
}
//#endregion
