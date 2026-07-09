//#region Imports

import { LineAction, LineInstruction } from "../types/drawProtocol"
import { ColorPallet, ColorType } from "../types/primitive"
//#endregion

//#region Helper Method
function setPixelFill(
  action: LineAction,
  color: ColorType,
  setPixel: (idx: number, color: ColorType) => void,
): void {}
//#endregion

//#region Handle Methods
export function handleDrawFillStart(
  canvas: HTMLCanvasElement,
  da: LineAction,
  cp: ColorPallet,
  ev: PointerEvent,
): LineInstruction | null {
  return null
}
export function handleDrawFillFinish(
  canvas: HTMLCanvasElement,
  da: LineAction,
  cp: ColorPallet,
  ev: PointerEvent,
): LineInstruction | null {
  return null
}
export function handleDrawFillMotion(
  canvas: HTMLCanvasElement,
  da: LineAction,
  cp: ColorPallet,
  ev: PointerEvent,
): LineInstruction | null {
  return null
}
export function handleDrawFillLeave(
  canvas: HTMLCanvasElement,
  da: LineAction,
  cp: ColorPallet,
  ev: PointerEvent,
): LineInstruction | null {
  return null
}
export function handleDrawFillInstruction(
  pixels: ImageData | Uint8ClampedArray<ArrayBufferLike>,
  inst: LineInstruction,
): void {}
//#endregion
