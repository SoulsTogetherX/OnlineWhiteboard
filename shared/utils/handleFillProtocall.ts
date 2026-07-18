//#region Imports
import {
  getCanvasState,
  getDrawerMethod,
  getIdxFromVec,
  getLookAtMethod,
  getPosCorrected,
  updateCanvas,
  withRecording,
} from "./helperProtocallMethods"

import { CANVAS_HEIGHT, CANVAS_WIDTH, DEFAULT_COLOR } from "../constants/canvas"
import { colorsEqual } from "../types/primitive"

import type {
  BaseInstruction,
  FillAction,
  FillInstruction,
  PatchEntry,
} from "../types/drawProtocol"
import type { ColorType } from "../types/primitive"
//#endregion

//#region Helper Method
function setPixelFill(
  action: FillAction,
  newColor: ColorType,
  imageData: ImageData | Uint8ClampedArray<ArrayBufferLike>,
  record?: PatchEntry[],
): void {
  // Get Data
  const startPos = action.pos ?? [0, 0]

  // Settup Methods
  const getColor = getLookAtMethod(action.type, imageData)
  let setColor = getDrawerMethod(action.type, imageData)
  if (record) {
    setColor = withRecording(getColor, setColor, record)
  }

  // Get Info
  const startIdx = getIdxFromVec(startPos)
  const targetColor = getColor(startIdx)

  if (colorsEqual(targetColor, newColor)) {
    // If the color here is already the newColor, return
    return
  }
  setColor(startIdx, newColor)

  // Set up Flood Fill
  const queue = [startPos]
  const directions = [
    [-1, 0],
    [1, 0],
    [0, -1],
    [0, 1],
  ]

  // Flood Fill
  while (queue.length > 0) {
    const [x, y] = queue.pop()!

    for (const [dx, dy] of directions) {
      const nx = x + dx,
        ny = y + dy
      const idx = getIdxFromVec([nx, ny])

      if (
        0 <= nx &&
        0 <= ny &&
        nx < CANVAS_WIDTH &&
        ny < CANVAS_HEIGHT &&
        colorsEqual(targetColor, getColor(idx))
      ) {
        setColor(idx, newColor)
        queue.push([nx, ny])
      }
    }
  }
}

function createInstruction(
  da: FillAction,
  base: BaseInstruction,
): FillInstruction {
  return {
    ...base,
    type: da.type,
    pos: da.pos,
  } as FillInstruction
}
//#endregion

//#region Handle Methods
export function handleDrawFillStart(
  _canvas: HTMLCanvasElement,
  _base: BaseInstruction,
  _da: FillAction,
  _ev: PointerEvent,
): FillInstruction | null {
  return null
}
export function handleDrawFillFinish(
  canvas: HTMLCanvasElement,
  base: BaseInstruction,
  da: FillAction,
  ev: PointerEvent,
  record?: PatchEntry[],
): FillInstruction | null {
  const next = getPosCorrected(ev, canvas)
  da.pos = next[0]
  if (next[1] === false) {
    return null
  }

  const canvasState = getCanvasState(canvas)
  if (canvasState === null) {
    return null
  }

  setPixelFill(da, base.color ?? DEFAULT_COLOR, canvasState.imageData, record)
  updateCanvas(canvas)
  return createInstruction(da, base)
}
export function handleDrawFillMotion(
  _canvas: HTMLCanvasElement,
  _base: BaseInstruction,
  _da: FillAction,
  _ev: PointerEvent,
): FillInstruction | null {
  return null
}
export function handleDrawFillLeave(
  _canvas: HTMLCanvasElement,
  _base: BaseInstruction,
  _da: FillAction,
  _ev: PointerEvent,
): FillInstruction | null {
  return null
}
export function handleDrawFillInstruction(
  pixels: ImageData | Uint8ClampedArray<ArrayBufferLike>,
  inst: FillInstruction,
): void {
  setPixelFill(inst, inst.color ?? DEFAULT_COLOR, pixels)
}
//#endregion
