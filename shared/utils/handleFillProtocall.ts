//#region Imports
import {
  getCanvasState,
  getDirectColor,
  getDrawerMethod,
  getIdxFromVec,
  getLookAtMethod,
  getPosCorrected,
  getToolColor,
  updateCanvas,
} from "./helperProtocallMethods"

import { CANVAS_HEIGHT, CANVAS_WIDTH } from "../constants/canvas"

import type { FillAction, FillInstruction } from "../types/drawProtocol"
import type { ColorPallet, ColorType } from "../types/primitive"
//#endregion

//#region Helper Method
function setPixelFill(
  action: FillAction,
  newColor: ColorType,
  imageData: ImageData | Uint8ClampedArray<ArrayBufferLike>,
): void {
  // Get Data
  const startPos = action.pos ?? [0, 0]

  // Settup Methods
  const compairColors = (color1: ColorType, color2: ColorType): boolean => {
    return (
      color1.r === color2.r &&
      color1.g === color2.g &&
      color1.b === color2.b &&
      color1.a === color2.a
    )
  }
  const getColor = getLookAtMethod(action.type, imageData)
  const setColor = getDrawerMethod(action.type, imageData)

  // Get Info
  const startIdx = getIdxFromVec(startPos)
  const targetColor = getColor(startIdx)

  if (compairColors(targetColor, newColor)) {
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
        compairColors(targetColor, getColor(idx))
      ) {
        setColor(idx, newColor)
        queue.push([nx, ny])
      }
    }
  }
}

function createInstruction(da: FillAction, color: ColorType): FillInstruction {
  return {
    type: da.type,
    pos: da.pos,
    color,
  } as FillInstruction
}
//#endregion

//#region Handle Methods
export function handleDrawFillStart(
  _canvas: HTMLCanvasElement,
  _da: FillAction,
  _cp: ColorPallet,
  _ev: PointerEvent,
): FillInstruction | null {
  return null
}
export function handleDrawFillFinish(
  canvas: HTMLCanvasElement,
  da: FillAction,
  cp: ColorPallet,
  ev: PointerEvent,
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

  const color = getToolColor(da.type, getDirectColor(cp, ev))
  setPixelFill(da, color, canvasState.imageData)
  updateCanvas(canvas)
  return createInstruction(da, color)
}
export function handleDrawFillMotion(
  _canvas: HTMLCanvasElement,
  _da: FillAction,
  _cp: ColorPallet,
  _ev: PointerEvent,
): FillInstruction | null {
  return null
}
export function handleDrawFillLeave(
  _canvas: HTMLCanvasElement,
  _da: FillAction,
  _cp: ColorPallet,
  _ev: PointerEvent,
): FillInstruction | null {
  return null
}
export function handleDrawFillInstruction(
  pixels: ImageData | Uint8ClampedArray<ArrayBufferLike>,
  inst: FillInstruction,
): void {
  setPixelFill(inst, inst.color, pixels)
}
//#endregion
