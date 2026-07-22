//#region Imports
import { useRef } from "react"

import useDrag from "./useDrag"
import useDrawActions, { type OnCommitAction } from "../useDrawActions"

import type { DrawAction, DrawInstruction } from "@shared/types/drawProtocol"
import { createStabilizer } from "@/utils/stabilizer"

import type { Stabilizer } from "@/utils/stabilizer"
import type { ColorPalette } from "@shared/types/primitive"
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
  colorPalette: React.RefObject<ColorPalette>,
  onDrawInstruction: (action: DrawInstruction) => void,
  onCommitAction?: OnCommitAction,
  // When this ref reads true, pointer gestures don't draw. Used by the
  // eyedropper: while sampling, a click must pick a colour, not lay down paint.
  disabledRef?: React.RefObject<boolean>,
  // Brush diameter, forwarded to the draw actions (read at gesture start).
  strokeSizeRef?: React.RefObject<number>,
  // Spray density, forwarded to the draw actions (read at gesture start).
  sprayDensityRef?: React.RefObject<number>,
  // When true, this client is a viewer — block drawing entirely. The server
  // also rejects a viewer's draws, but blocking locally avoids strokes flashing
  // on the viewer's own canvas and then being reverted on the next resync.
  viewOnlyRef?: React.RefObject<boolean>,
  // Stroke smoothing strength. Purely local: it changes WHERE the gesture
  // reports the pointer to be, before any instruction is built (see
  // utils/stabilizer), so nothing about the protocol changes.
  stabilizationRef?: React.RefObject<number>,
): void {
  // One stabilizer for the component's lifetime; it is reset at each gesture
  // start rather than recreated, so there is no per-stroke allocation on a path
  // that runs on every pointer event.
  const stabilizer = useRef<Stabilizer | null>(null)
  if (stabilizer.current === null) {
    stabilizer.current = createStabilizer(stabilizationRef ?? { current: 0 })
  }

  const [start, finish, motion, leave] = useDrawActions(
    canvasRef,
    onCommitAction,
    strokeSizeRef,
    sprayDensityRef,
  )

  const isDisabled = () =>
    disabledRef?.current === true || viewOnlyRef?.current === true

  // Shift is the navigate modifier (see useCanvasMotion): while it is held the
  // pointer pans the board, so it must not also lay down paint. Checked per
  // event rather than as a mode flag, so releasing shift mid-gesture behaves.
  const isNavigating = (ev: PointerEvent) => ev.shiftKey

  // Each of these runs from a pointer event, so reading `.current` here is
  // correct — it picks up the tool and palette as they are at gesture time
  // rather than whatever they were when this hook last rendered.
  const emit = (instruction: DrawInstruction | null) => {
    if (instruction) {
      onDrawInstruction(instruction)
    }
  }

  const blocked = (ev: PointerEvent) => isDisabled() || isNavigating(ev)

  // Smoothing applies only to the tools you DRAG. A bucket fill and an
  // eyedropper act on the single pixel you clicked, so a lagging average would
  // just put the click somewhere you did not aim.
  const smooths = (type: string) =>
    type === "pencil" || type === "eraser" || type === "spray"

  const steady = (ev: PointerEvent): PointerEvent =>
    smooths(drawAction.current.type)
      ? (stabilizer.current as Stabilizer).step(ev)
      : ev

  const onDrawStart = (ev: PointerEvent) =>
    blocked(ev)
      ? undefined
      : emit(
          start(
            drawAction.current,
            colorPalette.current,
            (stabilizer.current as Stabilizer).begin(ev),
          ),
        )
  const onDrawFinish = (ev: PointerEvent) =>
    blocked(ev) ? undefined : emit(finish(drawAction.current, steady(ev)))
  const onDrawMotion = (ev: PointerEvent) =>
    blocked(ev) ? undefined : emit(motion(drawAction.current, steady(ev)))
  const onDrawLeave = (ev: PointerEvent) =>
    blocked(ev) ? undefined : emit(leave(drawAction.current, steady(ev)))

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
