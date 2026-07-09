//#region Imports
import { useEffect } from "react"

import settupDrawActions from "@shared/utils/handleCanvasProtocol"

import type { DrawAction, DrawInstruction } from "@shared/types/drawProtocol"
import type { ColorPallet } from "@shared/types/primitive"
//#endregion

//#region Hook Def
export default function useCanvasDrawing(
  canvasRef: React.RefObject<HTMLCanvasElement | null>,
  drawAction: React.RefObject<DrawAction>,
  colorPallet: React.RefObject<ColorPallet>,
  onDrawInstruction?: (action: DrawInstruction) => void,
): void {
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) {
      return
    }

    const [
      handleDrawActionStart,
      handleDrawActionFinish,
      handleDrawActionMotion,
      handleDrawActionLeave,
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
    const onDrawLeave = (ev: PointerEvent) => {
      if (pointerId !== ev.pointerId || !isDragging) {
        return
      }
      const action = handleDrawActionLeave(
        drawAction.current,
        colorPallet.current,
        ev,
      )
      if (action) {
        onDrawInstruction?.(action)
      }
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

      const action = handleDrawActionMotion(
        drawAction.current,
        colorPallet.current,
        ev,
      )
      if (action) {
        onDrawInstruction?.(action)
      }
    }

    canvas.addEventListener("pointerdown", onDrawStart)
    canvas.addEventListener("pointerleave", onDrawLeave)

    document.addEventListener("pointerup", onDrawFinish)
    document.addEventListener("pointermove", onDrawMove)

    return () => {
      canvas.removeEventListener("pointerdown", onDrawStart)
      canvas.removeEventListener("pointerleave", onDrawLeave)

      document.removeEventListener("pointerup", onDrawFinish)
      document.removeEventListener("pointermove", onDrawMove)
    }
  }, [canvasRef, onDrawInstruction])
}
//#endregion
