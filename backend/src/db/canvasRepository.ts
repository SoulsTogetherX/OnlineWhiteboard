//#region Imports
import pool from "./pool"

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

//#region Schema
async function ensureCanvasTable(): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS canvases (
      room_id TEXT PRIMARY KEY,
      width INTEGER NOT NULL,
      height INTEGER NOT NULL,
      rgba BYTEA NOT NULL,
      revision INTEGER NOT NULL DEFAULT 0,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `)
}
//#endregion

//#region Repository Methods
function clearCanvas(): Uint8ClampedArray {
  return new Uint8ClampedArray(CANVAS_BYTES)
}

export async function loadCanvas(roomId: string): Promise<StoredCanvas> {
  await ensureCanvasTable()

  const result = await pool.query<{
    rgba: Buffer
    revision: number
    width: number
    height: number
  }>(
    `
      SELECT rgba, revision, width, height
      FROM canvases
      WHERE room_id = $1
    `,
    [roomId],
  )

  const row = result.rows[0]
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

export async function saveCanvas(
  roomId: string,
  pixels: Uint8ClampedArray,
  revision: number,
): Promise<void> {
  await ensureCanvasTable()

  await pool.query(
    `
      INSERT INTO canvases (room_id, width, height, rgba, revision, updated_at)
      VALUES ($1, $2, $3, $4, $5, NOW())
      ON CONFLICT (room_id)
      DO UPDATE SET
        width = EXCLUDED.width,
        height = EXCLUDED.height,
        rgba = EXCLUDED.rgba,
        revision = EXCLUDED.revision,
        updated_at = NOW()
    `,
    [roomId, CANVAS_WIDTH, CANVAS_HEIGHT, Buffer.from(pixels), revision],
  )
}
//#endregion
