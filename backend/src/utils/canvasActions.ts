//#region Imports
import { CANVAS_HEIGHT, CANVAS_WIDTH } from "@shared/constants/canvas"

import type { ColorType, Vec } from "@shared/types/primitive"
import type {
  DrawInstruction,
  PencilInstruction,
} from "@shared/types/drawProtocol"
//#endregion

//#region Helper Methods
function clamp(val: number, min: number, max: number): number {
  return Math.max(Math.min(val, max), min)
}

function normalizePos(pos: Vec): Vec {
  return [
    clamp(Math.trunc(pos[0]), 0, CANVAS_WIDTH - 1),
    clamp(Math.trunc(pos[1]), 0, CANVAS_HEIGHT - 1),
  ]
}

function getIdx(vec: Vec): number {
  return (vec[1] * CANVAS_WIDTH + vec[0]) << 2
}

function setPixel(
  canvas: Uint8ClampedArray,
  idx: number,
  color: ColorType,
): void {
  canvas[idx + 0] = color.r
  canvas[idx + 1] = color.g
  canvas[idx + 2] = color.b
  canvas[idx + 3] = color.a
}

function applyPencilInstruction(
  canvas: Uint8ClampedArray,
  action: PencilInstruction,
): void {
  let [x0, y0] = normalizePos(action.prevPos)
  const [x1, y1] = normalizePos(action.nextPos)

  const dx = Math.abs(x1 - x0)
  const dy = Math.abs(y1 - y0)
  const sx = x0 < x1 ? 1 : -1
  const sy = y0 < y1 ? 1 : -1

  let err = dx - dy
  while (true) {
    setPixel(canvas, getIdx([x0, y0]), action.color)

    if (x0 === x1 && y0 === y1) {
      break
    }

    const e2 = err << 1
    if (e2 > -dy) {
      err -= dy
      x0 += sx
    }
    if (e2 < dx) {
      err += dx
      y0 += sy
    }
  }
}

export function applyDrawInstruction(
  canvas: Uint8ClampedArray,
  action: DrawInstruction,
): void {
  switch (action.type) {
    case "pencil":
      applyPencilInstruction(canvas, action)
      break
  }
}
//#endregion
