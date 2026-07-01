//#region Imports
import { useEffect } from "react"

import settupDrawActions from "../utils/handleDrawAction"

import type { DrawAction } from "../types/drawAction"
import type { ColorPallet } from "../types/colorPallet"
//#endregion

//#region Hook Def
function useCanvasDrawing(
  canvasRef: React.RefObject<HTMLCanvasElement | null>,
  drawAction: React.RefObject<DrawAction>,
  colorPallet: React.RefObject<ColorPallet>,
) {
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) {
      return
    }

    const [
      handleDrawActionStart,
      handleDrawActionFinish,
      handleDrawActionMotion,
    ] = settupDrawActions(canvas)

    let isDragging = false
    let pointerId: number | null = null

    const onDrawStart = (ev: PointerEvent) => {
      if (pointerId !== null || isDragging) {
        return
      }

      pointerId = ev.pointerId
      isDragging = true

      handleDrawActionStart(drawAction.current, colorPallet.current, ev)
    }
    const onDrawFinish = (ev: PointerEvent) => {
      if (pointerId !== ev.pointerId || !isDragging) {
        return
      }

      pointerId = null
      isDragging = false

      handleDrawActionFinish(drawAction.current, colorPallet.current, ev)
    }
    const onDrawMove = (ev: PointerEvent) => {
      if (pointerId !== ev.pointerId || !isDragging) {
        return
      }

      handleDrawActionMotion(drawAction.current, colorPallet.current, ev)
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
