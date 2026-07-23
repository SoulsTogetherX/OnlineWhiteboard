//#region Imports
import { db } from "./pool"
import { packPixels, unpackPixels } from "./pixelStorage"

import { DEFAULT_CANVAS_DIMS, canvasBytes } from "@shared/constants/canvas"

import type { CanvasDims } from "@shared/constants/canvas"
//#endregion

//#region Type Defs
export type StoredCanvas = {
  pixels: Uint8ClampedArray
  revision: number
  // A room's size travels WITH its pixels now. The snapshot row is authoritative:
  // its stored width/height are the room's dimensions, and a brand-new room (no
  // snapshot) starts at the default.
  width: number
  height: number
}
//#endregion

//#region Repository Methods
function blankCanvas(dims: CanvasDims): StoredCanvas {
  return {
    pixels: new Uint8ClampedArray(canvasBytes(dims)),
    revision: 0,
    width: dims.width,
    height: dims.height,
  }
}

// Loads a room's canvas from its latest snapshot, at whatever dimensions that
// snapshot was stored at. The caller replays any draw_events newer than this
// snapshot's revision on top of it.
export async function loadCanvas(roomId: string): Promise<StoredCanvas> {
  const row = await db
    .selectFrom("canvas_snapshots")
    .select(["rgba", "revision", "width", "height"])
    .where("room_id", "=", roomId)
    .orderBy("revision", "desc")
    .limit(1)
    .executeTakeFirst()

  // No snapshot yet: a brand-new room starts blank at the default size.
  if (!row) {
    return blankCanvas(DEFAULT_CANVAS_DIMS)
  }

  const dims = { width: row.width, height: row.height }

  // Stored gzipped, validated against the row's OWN dimensions. An unreadable or
  // wrong-length snapshot degrades to a blank canvas at the default rather than
  // throwing — the room still opens, and any draw_events past revision 0 still
  // replay on top. (A resized room whose only snapshot is corrupt is a rare loss;
  // starting it at the default is the safe floor.)
  const pixels = unpackPixels(row.rgba, dims)
  if (pixels === null) {
    console.error(
      `canvas snapshot for room "${roomId}" at revision ${row.revision} could ` +
        `not be decompressed (${row.rgba.length} stored bytes, ` +
        `${dims.width}x${dims.height}); starting blank`,
    )
    return blankCanvas(DEFAULT_CANVAS_DIMS)
  }

  return {
    pixels,
    revision: row.revision,
    width: dims.width,
    height: dims.height,
  }
}

// Loads a room's GENESIS base snapshot — the EARLIEST one, which the timeline
// replays forward from for start-to-end playback. Mirror of loadCanvas, which
// loads the latest/head snapshot for recovery. Returns null for a room with no
// snapshot at all (a brand-new room before its base is seeded) or an unreadable
// base row, so the caller can fall back.
export async function loadBaseCanvas(
  roomId: string,
): Promise<StoredCanvas | null> {
  const row = await db
    .selectFrom("canvas_snapshots")
    .select(["rgba", "revision", "width", "height"])
    .where("room_id", "=", roomId)
    .orderBy("revision", "asc")
    .limit(1)
    .executeTakeFirst()

  if (!row) {
    return null
  }

  const dims = { width: row.width, height: row.height }
  const pixels = unpackPixels(row.rgba, dims)
  if (pixels === null) {
    return null
  }

  return { pixels, revision: row.revision, width: dims.width, height: dims.height }
}

// Writes a snapshot AND maintains the retained history. In one transaction it:
// ensures the room exists, stores the pixel buffer at this revision, keeps the
// right snapshots, and prunes the draw_events the retained history no longer
// needs. Doing all of it atomically is what makes it crash-safe — a crash
// mid-save can never leave a room without a snapshot or events deleted before
// the snapshot that replaced them was durably committed.
//
// Two snapshots are kept per room: the genesis BASE (earliest) and the HEAD
// (this revision). Recovery reads the head + events after it; start-to-end
// playback reads the base + events after it — so every event after the base is
// retained (the span is bounded separately by uniform decimation, see
// saveRoom/historyDecimation). Anything at or below the base is baked into the
// base snapshot, so pruning it is safe.
//
// `resetBase = true` collapses to a single snapshot: it prunes all older
// snapshots AND all events this snapshot supersedes, making this revision the
// new base+head. Only a RESIZE uses it — old-canvas-coordinate events cannot
// replay onto the new buffer, so the timeline restarts at the resize (the
// Phase 4 hard history boundary).
export async function saveCanvas(
  roomId: string,
  pixels: Uint8ClampedArray,
  revision: number,
  dims: CanvasDims,
  resetBase = false,
): Promise<void> {
  // Gzipped for storage — see pixelStorage.ts. Captured before the transaction
  // so the compressed bytes match the revision being written, even though live
  // draws keep mutating `pixels` underneath.
  const buffer = packPixels(pixels)

  await db.transaction().execute(async (trx) => {
    // Upsert the room. First save creates it; later saves advance the head
    // revision and the updated_at clock AND write the room's dimensions — a
    // resize changes them, so they cannot be insert-only. title/created_at are
    // left alone so existing metadata survives.
    await trx
      .insertInto("rooms")
      .values({
        id: roomId,
        width: dims.width,
        height: dims.height,
        revision,
        updated_at: new Date(),
      })
      .onConflict((oc) =>
        oc.column("id").doUpdateSet({
          revision,
          width: dims.width,
          height: dims.height,
          updated_at: new Date(),
        }),
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
        width: dims.width,
        height: dims.height,
        rgba: buffer,
      })
      .onConflict((oc) =>
        oc.columns(["room_id", "revision"]).doUpdateSet({
          rgba: buffer,
          width: dims.width,
          height: dims.height,
        }),
      )
      .execute()

    if (resetBase) {
      // RESET (resize): this snapshot becomes the sole snapshot — the new
      // base+head — and every event it supersedes is dropped, because they are
      // in old-canvas coordinates and cannot replay onto the new buffer.
      await trx
        .deleteFrom("canvas_snapshots")
        .where("room_id", "=", roomId)
        .where("revision", "<", revision)
        .execute()
      await trx
        .deleteFrom("draw_events")
        .where("room_id", "=", roomId)
        .where("revision", "<=", revision)
        .execute()
      return
    }

    // Keep the genesis BASE (earliest snapshot) and the HEAD (this revision);
    // prune the snapshots strictly between them — intermediate rolling snapshots
    // are only recovery shortcuts, and the base + head are the two we replay from
    // (playback from the base, recovery from the head).
    const baseRow = await trx
      .selectFrom("canvas_snapshots")
      .select("revision")
      .where("room_id", "=", roomId)
      .orderBy("revision", "asc")
      .limit(1)
      .executeTakeFirst()
    // No earlier snapshot (a first save with no seeded base) → this revision is
    // itself the base, so nothing before it is retained.
    const baseRevision = baseRow?.revision ?? revision

    await trx
      .deleteFrom("canvas_snapshots")
      .where("room_id", "=", roomId)
      .where("revision", ">", baseRevision)
      .where("revision", "<", revision)
      .execute()

    // COMPACTION. Everything at or below the base is baked into the base
    // snapshot, so neither recovery nor playback needs it. Retain every event
    // ABOVE the base so the timeline replays start-to-end; its growth is bounded
    // separately by uniform decimation (saveRoom).
    await trx
      .deleteFrom("draw_events")
      .where("room_id", "=", roomId)
      .where("revision", "<=", baseRevision)
      .execute()
  })
}
//#endregion
