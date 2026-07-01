//#region Imports
import { CANVAS_WIDTH, CANVAS_HEIGHT } from "../constants/canvas"
import type { ColorPallet } from "../types/colorPallet"
import type ColorType from "../types/colorType"

import type { DrawAction, PencilAction } from "../types/drawAction"
import type { Vec } from "../types/vector"
//#endregion

//#region Helper Method
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
function settupDrawActions(canvas: HTMLCanvasElement) {
  canvas.width = CANVAS_WIDTH
  canvas.height = CANVAS_HEIGHT

  const ctx = canvas.getContext("2d")
  if (!ctx) {
    return []
  }
  const imageData = ctx.getImageData(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT)

  const getPos = (ev: PointerEvent): Vec => {
    const rect = canvas.getBoundingClientRect()
    const scaleX = CANVAS_WIDTH / rect.width
    const scaleY = CANVAS_HEIGHT / rect.height

    const x = Math.max(
      Math.min(Math.floor((ev.clientX - rect.left) * scaleX), CANVAS_WIDTH),
      0,
    )
    const y = Math.max(
      Math.min(Math.floor((ev.clientY - rect.top) * scaleY), CANVAS_HEIGHT),
      0,
    )

    return [x, y]
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
        da.nextPos = getPos(ev)
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
        da.prevPos = da.nextPos
        da.nextPos = getPos(ev)

        const c = getColor(cp, ev)
        console.log(ev.button)
        if (!c) {
          return
        }

        setPixelLine(da, c, setPixel)
        ctx.putImageData(imageData, 0, 0)
        break
    }
  }

  return [handleDrawActionStart, handleDrawActionFinish, handleDrawActionMotion]
}
//#endregion

//#region Exports
export default settupDrawActions
//#endregion
