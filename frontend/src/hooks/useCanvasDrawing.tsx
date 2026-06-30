//#region Imports
import { useEffect } from "react"

import { CANVAS_WIDTH, CANVAS_HEIGHT } from "../constants/canvas"

import type { ColorType } from "../types/colorType.d"
import type drawOptions from "../types/drawOption"
//#endregion

//#region Hook Def
function useCanvasDrawing(
  canvasRef: React.RefObject<HTMLCanvasElement | null>,
  drawInfo: React.RefObject<drawOptions>,
) {
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) {
      return
    }

    canvas.width = CANVAS_WIDTH
    canvas.height = CANVAS_HEIGHT

    const ctx = canvas.getContext("2d")
    if (!ctx) {
      return
    }

    const imageData = ctx.getImageData(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT)

    let isDragging = false
    let pointerId: number | null = null

    const getPos = (ev: PointerEvent): [number, number] => {
      const rect = canvas.getBoundingClientRect()
      const scaleX = canvas.width / rect.width
      const scaleY = canvas.height / rect.height

      const x = Math.max(
        Math.min(Math.floor((ev.clientX - rect.left) * scaleX), canvas.width),
        0,
      )
      const y = Math.max(
        Math.min(Math.floor((ev.clientY - rect.top) * scaleY), canvas.height),
        0,
      )

      return [x, y]
    }

    const getIdx = (ev: PointerEvent): number => {
      const [c, r] = getPos(ev)
      return (r * canvas.width + c) << 2
    }

    const setPixel = (idx: number, color: ColorType) => {
      imageData.data[idx + 0] = color.r
      imageData.data[idx + 1] = color.g
      imageData.data[idx + 2] = color.b
      imageData.data[idx + 3] = color.a
    }

    const onDrawStart = (ev: PointerEvent) => {
      if (pointerId !== null || isDragging) return
      pointerId = ev.pointerId
      isDragging = true
    }

    const onDrawFinish = (ev: PointerEvent) => {
      if (pointerId !== ev.pointerId || !isDragging) return
      pointerId = null
      isDragging = false
    }

    const onDrawMove = (ev: PointerEvent) => {
      if (pointerId !== ev.pointerId || !isDragging) return
      setPixel(getIdx(ev), drawInfo.current.color)
      ctx.putImageData(imageData, 0, 0)
    }

    canvas.addEventListener("pointerdown", onDrawStart)
    canvas.addEventListener("pointerup", onDrawFinish)
    canvas.addEventListener("pointermove", onDrawMove)

    return () => {
      canvas.removeEventListener("pointerdown", onDrawStart)
      canvas.removeEventListener("pointerup", onDrawFinish)
      canvas.removeEventListener("pointermove", onDrawMove)
    }
  }, [canvasRef])
}
//#endregion

//#region Exports
export default useCanvasDrawing
//#endregion
