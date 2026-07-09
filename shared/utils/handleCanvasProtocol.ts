//#region Imports
import {
  createImageDataFromBase64,
  getCanvasState,
} from "./helperProtocallMethods"
import {
  handleDrawLineFinish,
  handleDrawLineInstruction,
  handleDrawLineLeave,
  handleDrawLineMotion,
  handleDrawLineStart,
} from "./handleLineProtocall"
import {
  handleDrawFillFinish,
  handleDrawFillInstruction,
  handleDrawFillLeave,
  handleDrawFillMotion,
  handleDrawFillStart,
} from "./handleFillProtocall"

import type { DrawAction, DrawInstruction } from "../types/drawProtocol"
import type { ColorPallet } from "../types/primitive"
//#endregion

//#region Type Def
type DrawHandlerMethod = (
  da: DrawAction,
  cp: ColorPallet,
  ev: PointerEvent,
) => DrawInstruction | null
//#endregion

//#region Settup Method
export default function settupDrawActions(
  canvas: HTMLCanvasElement,
): [
  DrawHandlerMethod,
  DrawHandlerMethod,
  DrawHandlerMethod,
  DrawHandlerMethod,
] {
  // Gets Canvas State
  const canvasState = getCanvasState(canvas)
  if (!canvasState) {
    const emptyFunction = (): DrawInstruction | null => null
    return [emptyFunction, emptyFunction, emptyFunction, emptyFunction]
  }

  const handleDrawActionStart = (
    da: DrawAction,
    cp: ColorPallet,
    ev: PointerEvent,
  ): DrawInstruction | null => {
    switch (da.type) {
      case "pencil":
      case "eraser":
        return handleDrawLineStart(canvas, da, cp, ev)
      case "bucket":
        return handleDrawFillStart(canvas, da, cp, ev)
    }
  }
  const handleDrawActionFinish = (
    da: DrawAction,
    cp: ColorPallet,
    ev: PointerEvent,
  ): DrawInstruction | null => {
    switch (da.type) {
      case "pencil":
      case "eraser":
        return handleDrawLineFinish(canvas, da, cp, ev)
      case "bucket":
        return handleDrawFillFinish(canvas, da, cp, ev)
    }
  }
  const handleDrawActionMotion = (
    da: DrawAction,
    cp: ColorPallet,
    ev: PointerEvent,
  ): DrawInstruction | null => {
    switch (da.type) {
      case "pencil":
      case "eraser":
        return handleDrawLineMotion(canvas, da, cp, ev)
      case "bucket":
        return handleDrawFillMotion(canvas, da, cp, ev)
    }
  }
  const handleDrawActionLeave = (
    da: DrawAction,
    cp: ColorPallet,
    ev: PointerEvent,
  ): DrawInstruction | null => {
    switch (da.type) {
      case "pencil":
      case "eraser":
        return handleDrawLineLeave(canvas, da, cp, ev)
      case "bucket":
        return handleDrawFillLeave(canvas, da, cp, ev)
    }
  }

  return [
    handleDrawActionStart,
    handleDrawActionFinish,
    handleDrawActionMotion,
    handleDrawActionLeave,
  ]
}
//#endregion

//#region Server-Driven Canvas Methods
export function applyDrawInstructionToCanvas(
  pixels: ImageData | Uint8ClampedArray<ArrayBufferLike>,
  inst: DrawInstruction,
): void {
  switch (inst.type) {
    case "pencil":
    case "eraser":
      handleDrawLineInstruction(pixels, inst)
      break
    case "bucket":
      handleDrawFillInstruction(pixels, inst)
      break
  }
}

export function applySnapshotToCanvas(
  canvas: HTMLCanvasElement,
  data: string,
): void {
  const canvasState = getCanvasState(canvas)
  if (!canvasState) {
    return
  }

  canvasState.imageData = createImageDataFromBase64(data)
  canvasState.ctx.putImageData(canvasState.imageData, 0, 0)
}
//#endregion
