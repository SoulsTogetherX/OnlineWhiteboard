//#region Imports
import { CANVAS_WIDTH, CANVAS_HEIGHT } from "../constants/canvas"
import type { ColorPallet } from "../types/colorPallet"
import type { ColorType } from "../types/colorType"

import type { DrawAction, PencilAction } from "../types/drawAction"
import type { Vec } from "../types/vector"
//#endregion

//#region Type Def
type drawHandlerMethod = (
  da: DrawAction,
  cp: ColorPallet,
  ev: PointerEvent,
) => void
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
  action: PencilAction,
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
//#endregion

//#region Settup Method
function settupDrawActions(
  canvas: HTMLCanvasElement,
): [
  drawHandlerMethod,
  drawHandlerMethod,
  drawHandlerMethod,
  drawHandlerMethod,
] {
  canvas.width = CANVAS_WIDTH
  canvas.height = CANVAS_HEIGHT

  const ctx = canvas.getContext("2d")
  if (!ctx) {
    const emptyFunction = (): void => {}
    return [emptyFunction, emptyFunction, emptyFunction, emptyFunction]
  }
  const imageData = ctx.getImageData(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT)

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
    imageData.data[idx + 0] = color.r
    imageData.data[idx + 1] = color.g
    imageData.data[idx + 2] = color.b
    imageData.data[idx + 3] = color.a
  }

  const handleDrawActionStart = (
    da: DrawAction,
    cp: ColorPallet,
    ev: PointerEvent,
  ) => {
    switch (da.type) {
      case "pencil":
        da.prevPos = undefined
        da.nextPos = getPosCorrected(ev)[0]
        break
    }
  }
  const handleDrawActionFinish = (
    da: DrawAction,
    cp: ColorPallet,
    ev: PointerEvent,
  ) => {
    switch (da.type) {
      case "pencil":
        break
    }
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
          return
        }

        const c = getColor(cp, ev)
        if (!c) {
          return
        }

        setPixelLine(da, c, setPixel)
        ctx.putImageData(imageData, 0, 0)
        break
    }
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
          return
        }

        setPixelLine(da, c, setPixel)
        ctx.putImageData(imageData, 0, 0)
        break
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

//#region Exports
export default settupDrawActions
//#endregion
