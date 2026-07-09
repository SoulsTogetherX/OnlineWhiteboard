//#region Imports
import {
  getCanvasState,
  getDirectColor,
  getDrawerMethod,
  getIdx,
  getPosCorrected,
  getToolColor,
  updateCanvas,
} from "./helperProtocallMethods"

import type { LineAction, LineInstruction } from "../types/drawProtocol"
import type { ColorPallet, ColorType } from "../types/primitive"
//#endregion

//#region Helper Method
function setPixelLine(
  action: LineAction,
  color: ColorType,
  setPixel: (idx: number, color: ColorType) => void,
): void {
  if (!action.prevPos || !action.nextPos) {
    return
  }

  let x0 = action.prevPos[0]
  let y0 = action.prevPos[1]
  const x1 = action.nextPos[0]
  const y1 = action.nextPos[1]

  const dx = Math.abs(x1 - x0)
  const dy = Math.abs(y1 - y0)
  const sx = x0 < x1 ? 1 : -1
  const sy = y0 < y1 ? 1 : -1

  let err = dx - dy
  while (true) {
    setPixel(getIdx([x0, y0]), color)

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

function createInstruction(da: LineAction, color: ColorType): LineInstruction {
  return {
    type: da.type,
    nextPos: da.nextPos,
    prevPos: da.prevPos,
    color,
  } as LineInstruction
}
//#endregion

//#region Handle Methods
export function handleDrawLineStart(
  canvas: HTMLCanvasElement,
  da: LineAction,
  _cp: ColorPallet,
  ev: PointerEvent,
): LineInstruction | null {
  const next = getPosCorrected(ev, canvas)

  da.prevPos = undefined
  da.nextPos = next[0]
  return null
}
export function handleDrawLineFinish(
  _canvas: HTMLCanvasElement,
  _da: LineAction,
  _cp: ColorPallet,
  _ev: PointerEvent,
): LineInstruction | null {
  return null
}
export function handleDrawLineMotion(
  canvas: HTMLCanvasElement,
  da: LineAction,
  cp: ColorPallet,
  ev: PointerEvent,
): LineInstruction | null {
  const next = getPosCorrected(ev, canvas)

  da.prevPos = da.nextPos
  da.nextPos = next[0]
  if (next[1] === false) {
    return null
  }

  const canvasState = getCanvasState(canvas)
  if (canvasState === null) {
    return null
  }

  const drawer = getDrawerMethod(da.type, canvasState.imageData)
  const color = getToolColor(da.type, getDirectColor(cp, ev))

  setPixelLine(da, color, drawer)
  updateCanvas(canvas)
  return createInstruction(da, color)
}
export function handleDrawLineLeave(
  canvas: HTMLCanvasElement,
  da: LineAction,
  cp: ColorPallet,
  ev: PointerEvent,
): LineInstruction | null {
  const canvasState = getCanvasState(canvas)
  if (canvasState === null) {
    return null
  }

  const drawer = getDrawerMethod(da.type, canvasState.imageData)
  const color = getToolColor(da.type, getDirectColor(cp, ev))

  setPixelLine(da, color, drawer)
  updateCanvas(canvas)
  return createInstruction(da, color)
}
export function handleDrawLineInstruction(
  pixels: ImageData | Uint8ClampedArray<ArrayBufferLike>,
  inst: LineInstruction,
): void {
  const drawer = getDrawerMethod(inst.type, pixels)
  setPixelLine(inst, inst.color, drawer)
}
//#endregion
