//#region Imports
import { CANVAS_HEIGHT, CANVAS_WIDTH } from "../constants/canvas"

import type { ToolType } from "../types/drawProtocol"
import type { ColorPallet, ColorType, Vec } from "../types/primitive"
//#endregion

//#region Type Defs
export type CanvasState = {
  ctx: CanvasRenderingContext2D
  imageData: ImageData
}

export type PixelInteractionMethod = (idx: number, color: ColorType) => void
//#endregion

//#region Constants
const canvasStates = new WeakMap<HTMLCanvasElement, CanvasState>()
//#endregion

//#region Helper Methods
export function clamp(val: number, min: number, max: number): number {
  return Math.max(Math.min(val, max), min)
}
export function getIdx(vec: Vec): number {
  return (vec[1] * CANVAS_WIDTH + vec[0]) << 2
}

export function createImageDataFromBase64(data: string): ImageData {
  const binary = atob(data)
  const bytes = new Uint8ClampedArray(binary.length)

  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i)
  }

  return new ImageData(bytes, CANVAS_WIDTH, CANVAS_HEIGHT)
}
//#endregion

//#region Canvas Methods
export function getCanvasState(canvas: HTMLCanvasElement): CanvasState | null {
  if (canvas.width !== CANVAS_WIDTH || canvas.height !== CANVAS_HEIGHT) {
    canvas.width = CANVAS_WIDTH
    canvas.height = CANVAS_HEIGHT
  }

  const ctx = canvas.getContext("2d")
  if (!ctx) {
    return null
  }

  const cached = canvasStates.get(canvas)
  if (cached) {
    return cached
  }

  const state: CanvasState = {
    ctx,
    imageData: ctx.getImageData(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT),
  }
  canvasStates.set(canvas, state)
  return state
}
export function updateCanvas(canvas: HTMLCanvasElement): void {
  const canvasState = getCanvasState(canvas)
  if (canvasState === null) {
    return
  }

  canvasState.ctx.putImageData(canvasState.imageData, 0, 0)
}

export function getPos(ev: PointerEvent, canvas: HTMLCanvasElement): Vec {
  const rect = canvas.getBoundingClientRect()
  const scaleX = CANVAS_WIDTH / rect.width
  const scaleY = CANVAS_HEIGHT / rect.height

  const x = Math.floor((ev.clientX - rect.left) * scaleX)
  const y = Math.floor((ev.clientY - rect.top) * scaleY)

  return [x, y]
}
export function getPosCorrected(
  ev: PointerEvent,
  canvas: HTMLCanvasElement,
): [Vec, boolean] {
  const [x, y] = getPos(ev, canvas)

  const correctedX = clamp(x, 0, CANVAS_WIDTH - 1)
  const correctedY = clamp(y, 0, CANVAS_HEIGHT - 1)

  if (x !== correctedX || y !== correctedY) {
    return [[correctedX, correctedY], false]
  }

  return [[x, y], true]
}
//#endregion

//#region ToolType Methods
export function getDrawerMethod(
  type: ToolType,
  imageData: ImageData | Uint8ClampedArray,
): PixelInteractionMethod {
  const image =
    imageData instanceof Uint8ClampedArray ? imageData : imageData.data

  switch (type) {
    case "pencil":
    case "eraser":
      return (idx: number, color: ColorType) => {
        image[idx + 0] = color.r
        image[idx + 1] = color.g
        image[idx + 2] = color.b
        image[idx + 3] = color.a
      }
    case "spray":
      break
    case "bucket":
      break
  }
  return () => {}
}
//#endregion

//#region Color Methods
export function getDirectColor(
  cp: ColorPallet,
  ev: PointerEvent,
): ColorType | null {
  if (ev.pointerType !== "mouse" || (ev.buttons & 1) === 1) {
    return cp.primary
  } else if ((ev.buttons & 2) === 2) {
    return cp.secondary
  }
  return null
}

export function getToolColor(
  type: ToolType,
  defaultColor: ColorType | null,
): ColorType {
  if (type === "eraser" || defaultColor === null) {
    return { r: 0, g: 0, b: 0, a: 0 }
  }
  return defaultColor
}
//#endregion
