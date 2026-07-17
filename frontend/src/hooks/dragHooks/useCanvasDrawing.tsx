//#region Imports
import useDrag from "./useDrag"
import useDrawActions, { type OnCommitAction } from "../useDrawActions"

import type { DrawAction, DrawInstruction } from "@shared/types/drawProtocol"
import type { ColorPallet } from "@shared/types/primitive"
//#endregion

//#region Hook Def
// Adapts raw drag events into draw actions.
//
// This used to stash the four handlers in a `canvasMethods` ref and assign into
// it during render, purely to work around useDrawActions taking the canvas
// *element* (which is null on the first render). Now that useDrawActions takes
// the ref and resolves it at event time, that indirection is unnecessary — the
// handlers are just called directly.
export default function useCanvasDrawing(
  canvasRef: React.RefObject<HTMLCanvasElement | null>,
  drawAction: React.RefObject<DrawAction>,
  colorPallet: React.RefObject<ColorPallet>,
  onDrawInstruction: (action: DrawInstruction) => void,
  onCommitAction?: OnCommitAction,
  // When this ref reads true, pointer gestures don't draw. Used by the
  // eyedropper: while sampling, a click must pick a colour, not lay down paint.
  disabledRef?: React.RefObject<boolean>,
): void {
  const [start, finish, motion, leave] = useDrawActions(
    canvasRef,
    onCommitAction,
  )

  const isDisabled = () => disabledRef?.current === true

  // Each of these runs from a pointer event, so reading `.current` here is
  // correct — it picks up the tool and palette as they are at gesture time
  // rather than whatever they were when this hook last rendered.
  const emit = (instruction: DrawInstruction | null) => {
    if (instruction) {
      onDrawInstruction(instruction)
    }
  }

  const onDrawStart = (ev: PointerEvent) =>
    isDisabled() ? undefined : emit(start(drawAction.current, colorPallet.current, ev))
  const onDrawFinish = (ev: PointerEvent) =>
    isDisabled() ? undefined : emit(finish(drawAction.current, ev))
  const onDrawMotion = (ev: PointerEvent) =>
    isDisabled() ? undefined : emit(motion(drawAction.current, ev))
  const onDrawLeave = (ev: PointerEvent) =>
    isDisabled() ? undefined : emit(leave(drawAction.current, ev))

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
