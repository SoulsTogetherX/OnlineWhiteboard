//#region Imports
import { CANVAS_WIDTH, CANVAS_HEIGHT } from "../../constants/canvas"
import type { ColorPallet } from "../../types/primitive"
import type { ColorType } from "../../types/primitive"

import type {
  DrawAction,
  DrawInstruction,
  PencilAction,
} from "../../types/drawProtocol"
import type { Vec } from "../../types/primitive"
//#endregion

//#region Type Def
type drawHandlerMethod = (
  da: DrawAction,
  cp: ColorPallet,
  ev: PointerEvent,
) => DrawInstruction | null

type CanvasState = {
  ctx: CanvasRenderingContext2D
  imageData: ImageData
}
//#endregion

//#region Helper Method
function clamp(val: number, min: number, max: number): number {
  return Math.max(Math.min(val, max), min)
}

function getColor(cp: ColorPallet, ev: PointerEvent): ColorType | null {
  if (ev.pointerType !== "mouse" || (ev.buttons & 1) === 1) {
    return cp.primary
  } else if ((ev.buttons & 2) === 2) {
    return cp.secondary
  }
  return null
}

function getIdx(vec: Vec): number {
  return (vec[1] * CANVAS_WIDTH + vec[0]) << 2
}

function setPixelLine(
  action: PencilAction | DrawInstruction,
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

function createImageDataFromBase64(data: string): ImageData {
  const binary = atob(data)
  const bytes = new Uint8ClampedArray(binary.length)

  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i)
  }

  return new ImageData(bytes, CANVAS_WIDTH, CANVAS_HEIGHT)
}

const canvasStates = new WeakMap<HTMLCanvasElement, CanvasState>()

function getCanvasState(canvas: HTMLCanvasElement): CanvasState | null {
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
//#endregion

//#region Settup Method
export default function settupDrawActions(
  canvas: HTMLCanvasElement,
): [
  drawHandlerMethod,
  drawHandlerMethod,
  drawHandlerMethod,
  drawHandlerMethod,
] {
  const canvasState = getCanvasState(canvas)
  if (!canvasState) {
    const emptyFunction = (): DrawInstruction | null => null
    return [emptyFunction, emptyFunction, emptyFunction, emptyFunction]
  }
  const { ctx } = canvasState

  const getPos = (ev: PointerEvent): Vec => {
    const rect = canvas.getBoundingClientRect()
    const scaleX = CANVAS_WIDTH / rect.width
    const scaleY = CANVAS_HEIGHT / rect.height

    const x = Math.floor((ev.clientX - rect.left) * scaleX)
    const y = Math.floor((ev.clientY - rect.top) * scaleY)

    return [x, y]
  }
  const getPosCorrected = (ev: PointerEvent): [Vec, boolean] => {
    const [x, y] = getPos(ev)

    const correctedX = clamp(x, 0, CANVAS_WIDTH - 1)
    const correctedY = clamp(y, 0, CANVAS_HEIGHT - 1)

    if (x !== correctedX || y !== correctedY) {
      return [[correctedX, correctedY], false]
    }

    return [[x, y], true]
  }

  const setPixel = (idx: number, color: ColorType) => {
    canvasState.imageData.data[idx + 0] = color.r
    canvasState.imageData.data[idx + 1] = color.g
    canvasState.imageData.data[idx + 2] = color.b
    canvasState.imageData.data[idx + 3] = color.a
  }

  const handleDrawActionStart = (
    da: DrawAction,
    _cp: ColorPallet,
    ev: PointerEvent,
  ) => {
    switch (da.type) {
      case "pencil":
        da.prevPos = undefined
        da.nextPos = getPosCorrected(ev)[0]
        break
    }
    return null
  }
  const handleDrawActionFinish = (
    da: DrawAction,
    _cp: ColorPallet,
    _ev: PointerEvent,
  ) => {
    switch (da.type) {
      case "pencil":
        break
    }
    return null
  }
  const handleDrawActionMotion = (
    da: DrawAction,
    cp: ColorPallet,
    ev: PointerEvent,
  ) => {
    switch (da.type) {
      case "pencil":
        const next = getPosCorrected(ev)

        da.prevPos = da.nextPos
        da.nextPos = next[0]

        if (!next[1]) {
          return null
        }

        const c = getColor(cp, ev)
        if (!c) {
          return null
        }

        setPixelLine(da, c, setPixel)
        ctx.putImageData(canvasState.imageData, 0, 0)
        if (!da.prevPos || !da.nextPos) {
          return null
        }
        const instruction: DrawInstruction = {
          type: "pencil",
          prevPos: da.prevPos,
          nextPos: da.nextPos,
          color: c,
        }
        return instruction
    }
    return null
  }
  const handleDrawActionLeave = (
    da: DrawAction,
    cp: ColorPallet,
    ev: PointerEvent,
  ) => {
    switch (da.type) {
      case "pencil":
        const next = getPosCorrected(ev)

        da.prevPos = da.nextPos
        da.nextPos = next[0]

        const c = getColor(cp, ev)
        if (!c) {
          return null
        }

        setPixelLine(da, c, setPixel)
        ctx.putImageData(canvasState.imageData, 0, 0)
        if (!da.prevPos || !da.nextPos) {
          return null
        }
        const instruction: DrawInstruction = {
          type: "pencil",
          prevPos: da.prevPos,
          nextPos: da.nextPos,
          color: c,
        }
        return instruction
    }
    return null
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
  canvas: HTMLCanvasElement,
  action: DrawInstruction,
): void {
  const canvasState = getCanvasState(canvas)
  if (!canvasState) {
    return
  }

  const setPixel = (idx: number, color: ColorType) => {
    canvasState.imageData.data[idx + 0] = color.r
    canvasState.imageData.data[idx + 1] = color.g
    canvasState.imageData.data[idx + 2] = color.b
    canvasState.imageData.data[idx + 3] = color.a
  }

  setPixelLine(action, action.color, setPixel)
  canvasState.ctx.putImageData(canvasState.imageData, 0, 0)
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
