//#region Imports
import { useRef } from "react"

import useSessionID from "./useSessionID"
import { holdLocalPixels } from "@/utils/localHold"

import {
  handleDrawLineFinish,
  handleDrawLineLeave,
  handleDrawLineMotion,
  handleDrawLineStart,
} from "@shared/utils/handleLineProtocol"
import {
  handleDrawFillFinish,
  handleDrawFillLeave,
  handleDrawFillMotion,
  handleDrawFillStart,
} from "@shared/utils/handleFillProtocol"
import {
  handleDrawSprayFinish,
  handleDrawSprayLeave,
  handleDrawSprayMotion,
  handleDrawSprayStart,
} from "@shared/utils/handleSprayProtocol"
import {
  handleDrawBlurFinish,
  handleDrawBlurLeave,
  handleDrawBlurMotion,
  handleDrawBlurStart,
} from "@shared/utils/handleBlurProtocol"
import {
  canvasDimsOf,
  coalesceRecording,
  getDirectColor,
  getToolColor,
} from "@shared/utils/helperProtocolMethods"
import { DEFAULT_STROKE_SIZE } from "@shared/constants/canvas"

import type {
  BaseInstruction,
  DrawAction,
  DrawInstruction,
  PatchEntry,
} from "@shared/types/drawProtocol"
import type { ColorPalette } from "@shared/types/primitive"
//#endregion

//#region Type Def
export type DrawHandlerMethodStart = (
  da: DrawAction,
  cp: ColorPalette,
  ev: PointerEvent,
) => DrawInstruction | null
export type DrawHandlerMethod = (
  da: DrawAction,
  ev: PointerEvent,
) => DrawInstruction | null

export type UseDrawActionsReturn = [
  DrawHandlerMethodStart,
  DrawHandlerMethod,
  DrawHandlerMethod,
  DrawHandlerMethod,
]

// Called once per gesture, on Finish, with everything that gesture actually
// touched — this is what an undo-history hook uses to build one undoable
// entry per stroke/fill, without needing to know anything about pointer
// events itself.
export type OnCommitAction = (instructionId: number, entries: PatchEntry[]) => void
//#endregion

//#region Setup Method
// Takes the ref itself, NOT `canvasRef.current`.
//
// It used to take the element, read out of the ref during render by
// useCanvasDrawing. On the first render that value is `null` — the canvas has
// not mounted yet — so every handler closed over `canvas = null` and returned
// early. Drawing only started working once something *else* re-rendered App
// (in practice `socketLabel` flipping to "Connected") and rebuilt the handlers
// with a real element. It worked by luck of timing; a click landing before that
// re-render silently did nothing.
//
// Reading `.current` inside each handler instead is both correct and simpler:
// handlers only ever run from pointer events, long after mount.
export default function useDrawActions(
  canvasRef: React.RefObject<HTMLCanvasElement | null>,
  onCommitAction?: OnCommitAction,
  // Brush diameter, read at gesture start. A ref (not a value) so changing the
  // slider mid-session doesn't rebuild the handlers, matching how the tool and
  // palette are threaded.
  strokeSizeRef?: React.RefObject<number>,
  // Spray density, same ref-at-gesture-start treatment. Only used for spray.
  sprayDensityRef?: React.RefObject<number>,
  // Blur settings. On the wire for the same reason the spray's seed is: a blur's
  // result is computed FROM the canvas, so every client must use identical
  // numbers or they compute different pixels from the same event.
  blurSettingsRef?: React.RefObject<{
    blend: number
    opacity: number
    lockAlpha: boolean
  }>,
): UseDrawActionsReturn {
  const sessionId = useSessionID()
  const baseInstruction = useRef<BaseInstruction>({
    instructionId: -1,
    sessionId,
  })
  const record = useRef<PatchEntry[]>([])

  // Re-reads the brush settings off their refs into the instruction being built.
  //
  // Called on every motion event, not once at gesture start. A stroke is not one
  // instruction — it is one per pointermove, each carrying its own `size` — so
  // re-reading here makes the width you are currently set to the width the next
  // segment draws at. That is what lets the wheel resize the brush MID-STROKE
  // and have the line respond under the pointer, instead of the change sitting
  // unused until you lift and press again.
  //
  // Nothing about the protocol changed to allow this: every instruction already
  // carried its own size, and the old behaviour was simply the client choosing
  // to send the same number every time.
  const refreshBrushSettings = (da: DrawAction): void => {
    if (da.type === "blur" && blurSettingsRef?.current) {
      // Written onto the ACTION, not the base instruction: these are blur-only
      // fields, and the blur handler reads them from the action when it builds
      // its instruction.
      da.blend = blurSettingsRef.current.blend
      da.opacity = blurSettingsRef.current.opacity
      da.lockAlpha = blurSettingsRef.current.lockAlpha
    }
    baseInstruction.current.size = strokeSizeRef?.current ?? DEFAULT_STROKE_SIZE
    // Density is spray-only; leave it off other instructions so it doesn't ride
    // the wire for pencil/eraser/bucket.
    baseInstruction.current.density =
      da.type === "spray" ? sprayDensityRef?.current : undefined
  }

  const handleDrawActionStart = (
    da: DrawAction,
    cp: ColorPalette,
    ev: PointerEvent,
  ): DrawInstruction | null => {
    const canvas = canvasRef.current
    if (!canvas) {
      return null
    }
    const dims = canvasDimsOf(canvas)

    baseInstruction.current.instructionId += 1
    baseInstruction.current.color = getToolColor(
      da.type,
      getDirectColor(cp, ev),
    )
    refreshBrushSettings(da)
    record.current = []

    switch (da.type) {
      case "pencil":
      case "eraser":
        return handleDrawLineStart(
          canvas,
          baseInstruction.current,
          da,
          ev,
          dims,
          record.current,
        )
      case "bucket":
        return handleDrawFillStart(canvas, baseInstruction.current, da, ev)
      case "blur":
        return handleDrawBlurStart(
          canvas,
          baseInstruction.current,
          da,
          ev,
          dims,
          record.current,
        )
      case "spray":
        return handleDrawSprayStart(
          canvas,
          baseInstruction.current,
          da,
          ev,
          dims,
          record.current,
        )
    }
  }
  const handleDrawActionFinish = (
    da: DrawAction,
    ev: PointerEvent,
  ): DrawInstruction | null => {
    const canvas = canvasRef.current
    if (!canvas) {
      return null
    }
    const dims = canvasDimsOf(canvas)

    let instruction: DrawInstruction | null = null
    switch (da.type) {
      case "pencil":
      case "eraser":
        instruction = handleDrawLineFinish(
          canvas,
          baseInstruction.current,
          da,
          ev,
        )
        break
      case "bucket":
        instruction = handleDrawFillFinish(
          canvas,
          baseInstruction.current,
          da,
          ev,
          dims,
          record.current,
        )
        break
      case "blur":
        instruction = handleDrawBlurFinish(
          canvas,
          baseInstruction.current,
          da,
          ev,
        )
        break
      case "spray":
        instruction = handleDrawSprayFinish(
          canvas,
          baseInstruction.current,
          da,
          ev,
        )
        break
    }

    // One entry per PIXEL, not one per write. A brush repaints the same pixels
    // on every pointermove, so the raw recording of a large stroke runs to
    // several times the canvas's pixel count — past the ceiling patch validation
    // enforces, which is what made undo of a big stroke fail outright while
    // still lighting up the button. See coalesceRecording.
    const undoEntries = coalesceRecording(record.current)
    record.current = []

    if (undoEntries.length > 0) {
      // Hold the pixels this stroke just painted so a colliding remote
      // instruction cannot visibly wipe them for the next 100 ms (see
      // @/utils/localHold). Display-only — the recorded writes are already in the
      // authoritative buffer; this just keeps them SHOWN briefly.
      holdLocalPixels(undoEntries, Date.now())
      onCommitAction?.(baseInstruction.current.instructionId, undoEntries)
    }
    return instruction
  }
  const handleDrawActionMotion = (
    da: DrawAction,
    ev: PointerEvent,
  ): DrawInstruction | null => {
    const canvas = canvasRef.current
    if (!canvas) {
      return null
    }
    const dims = canvasDimsOf(canvas)

    // Picks up a size changed since the last segment, so the line thickens or
    // thins under the pointer while you are still drawing it.
    refreshBrushSettings(da)

    switch (da.type) {
      case "pencil":
      case "eraser":
        return handleDrawLineMotion(
          canvas,
          baseInstruction.current,
          da,
          ev,
          dims,
          record.current,
        )
      case "bucket":
        return handleDrawFillMotion(canvas, baseInstruction.current, da, ev)
      case "blur":
        return handleDrawBlurMotion(
          canvas,
          baseInstruction.current,
          da,
          ev,
          dims,
          record.current,
        )
      case "spray":
        return handleDrawSprayMotion(
          canvas,
          baseInstruction.current,
          da,
          ev,
          dims,
          record.current,
        )
    }
  }
  const handleDrawActionLeave = (
    da: DrawAction,
    ev: PointerEvent,
  ): DrawInstruction | null => {
    const canvas = canvasRef.current
    if (!canvas) {
      return null
    }
    const dims = canvasDimsOf(canvas)

    switch (da.type) {
      case "pencil":
      case "eraser":
        return handleDrawLineLeave(
          canvas,
          baseInstruction.current,
          da,
          ev,
          dims,
          record.current,
        )
      case "bucket":
        return handleDrawFillLeave(canvas, baseInstruction.current, da, ev)
      case "blur":
        return handleDrawBlurLeave(canvas, baseInstruction.current, da, ev)
      case "spray":
        return handleDrawSprayLeave(
          canvas,
          baseInstruction.current,
          da,
          ev,
          dims,
          record.current,
        )
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
