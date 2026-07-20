//#region Imports
import { db } from "./pool"
import { packPixels, unpackPixels } from "./pixelStorage"

import { CANVAS_HEIGHT, CANVAS_WIDTH } from "@shared/constants/canvas"
//#endregion

//#region Type Defs
// Listed metadata — deliberately NOT the pixel bytes, which are large. The
// bytes are fetched only when a checkpoint is actually loaded/restored.
export type CheckpointMeta = {
  id: string
  name: string
  revision: number
  createdAt: Date
}

export type LoadedCheckpoint = {
  pixels: Uint8ClampedArray
  revision: number
}

const MAX_CHECKPOINTS_PER_ROOM = 20
//#endregion

//#region Repository
export async function createCheckpoint(input: {
  roomId: string
  name: string
  revision: number
  pixels: Uint8ClampedArray
  createdBy: string | null
}): Promise<CheckpointMeta> {
  const row = await db
    .insertInto("checkpoints")
    .values({
      room_id: input.roomId,
      name: input.name,
      revision: input.revision,
      width: CANVAS_WIDTH,
      height: CANVAS_HEIGHT,
      // Gzipped for storage. Checkpoints are the heaviest thing in the schema —
      // a full canvas each, up to 20 per room — so this is where compression
      // pays most.
      rgba: packPixels(input.pixels),
      created_by: input.createdBy,
    })
    .returning(["id", "name", "revision", "created_at as createdAt"])
    .executeTakeFirstOrThrow()
  return row
}

export async function listCheckpoints(
  roomId: string,
): Promise<CheckpointMeta[]> {
  return db
    .selectFrom("checkpoints")
    .select(["id", "name", "revision", "created_at as createdAt"])
    .where("room_id", "=", roomId)
    .orderBy("created_at", "desc")
    .execute()
}

// Loads a checkpoint's pixels. Scoped by roomId as well as id so a checkpoint
// from another room can never be loaded into this one.
export async function loadCheckpoint(
  roomId: string,
  checkpointId: string,
): Promise<LoadedCheckpoint | null> {
  const row = await db
    .selectFrom("checkpoints")
    .select(["rgba", "revision", "width", "height"])
    .where("room_id", "=", roomId)
    .where("id", "=", checkpointId)
    .executeTakeFirst()

  if (!row || row.width !== CANVAS_WIDTH || row.height !== CANVAS_HEIGHT) {
    return null
  }

  // Null on undecompressable bytes joins the existing "no such checkpoint"
  // path, so a restore fails visibly instead of writing garbage over the live
  // canvas and broadcasting it to everyone.
  const pixels = unpackPixels(row.rgba)
  if (pixels === null) {
    console.error(
      `checkpoint "${checkpointId}" in room "${roomId}" could not be ` +
        `decompressed (${row.rgba.length} stored bytes)`,
    )
    return null
  }

  return {
    pixels,
    revision: row.revision,
  }
}

export async function deleteCheckpoint(
  roomId: string,
  checkpointId: string,
): Promise<boolean> {
  const result = await db
    .deleteFrom("checkpoints")
    .where("room_id", "=", roomId)
    .where("id", "=", checkpointId)
    .executeTakeFirst()
  return Number(result.numDeletedRows ?? 0n) > 0
}

export async function countCheckpoints(roomId: string): Promise<number> {
  const row = await db
    .selectFrom("checkpoints")
    .select((eb) => eb.fn.countAll<string>().as("count"))
    .where("room_id", "=", roomId)
    .executeTakeFirst()
  return Number(row?.count ?? 0)
}

export function maxCheckpointsPerRoom(): number {
  return MAX_CHECKPOINTS_PER_ROOM
}

// The revision of the OLDEST surviving checkpoint, or null if none. This is the
// compaction floor: draw_events newer than this are retained so history can be
// replayed forward from any checkpoint (see canvasRepository.saveCanvas).
export async function oldestCheckpointRevision(
  roomId: string,
): Promise<number | null> {
  const row = await db
    .selectFrom("checkpoints")
    .select("revision")
    .where("room_id", "=", roomId)
    .orderBy("revision", "asc")
    .limit(1)
    .executeTakeFirst()
  return row?.revision ?? null
}
//#endregion
