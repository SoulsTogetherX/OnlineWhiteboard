//#region Imports
import settupDrawActions from "@shared/utils/handleCanvasProtocol"

import type { DrawAction, DrawInstruction } from "@shared/types/drawProtocol"
import type { ColorPallet } from "@shared/types/primitive"
import useDrag from "./useDrag"
//#endregion

//#region Hook Def
export default function useCanvasDrawing(
  canvasRef: React.RefObject<HTMLCanvasElement | null>,
  drawAction: React.RefObject<DrawAction>,
  colorPallet: React.RefObject<ColorPallet>,
  onDrawInstruction: (action: DrawInstruction) => void,
): void {
  const canvas = canvasRef.current
  if (!canvas) {
    useDrag(canvasRef)
    return
  }

  const [
    handleDrawActionStart,
    handleDrawActionFinish,
    handleDrawActionMotion,
    handleDrawActionLeave,
  ] = settupDrawActions(canvas)

  const onDrawStart = (ev: PointerEvent) => {
    const instruction = handleDrawActionStart(
      drawAction.current,
      colorPallet.current,
      ev,
    )
    if (instruction) {
      onDrawInstruction(instruction)
    }
  }
  const onDrawLeave = (ev: PointerEvent) => {
    const instruction = handleDrawActionLeave(
      drawAction.current,
      colorPallet.current,
      ev,
    )
    if (instruction) {
      onDrawInstruction(instruction)
    }
  }

  const onDrawFinish = (ev: PointerEvent) => {
    const instruction = handleDrawActionFinish(
      drawAction.current,
      colorPallet.current,
      ev,
    )
    if (instruction) {
      onDrawInstruction(instruction)
    }
  }
  const onDrawMotion = (ev: PointerEvent) => {
    const instruction = handleDrawActionMotion(
      drawAction.current,
      colorPallet.current,
      ev,
    )
    if (instruction) {
      onDrawInstruction(instruction)
    }
  }

  useDrag(
    canvasRef,
    undefined,
    onDrawStart,
    onDrawFinish,
    onDrawMotion,
    onDrawLeave,
  )
}
//#endregion
