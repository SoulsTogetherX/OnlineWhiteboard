//#region Imports
import { useRef } from "react"

import useSessionID from "./useSessionID"

import {
  handleDrawLineFinish,
  handleDrawLineLeave,
  handleDrawLineMotion,
  handleDrawLineStart,
} from "@shared/utils/handleLineProtocall"
import {
  handleDrawFillFinish,
  handleDrawFillLeave,
  handleDrawFillMotion,
  handleDrawFillStart,
} from "@shared/utils/handleFillProtocall"
import {
  handleDrawSprayFinish,
  handleDrawSprayLeave,
  handleDrawSprayMotion,
  handleDrawSprayStart,
} from "@shared/utils/handleSprayProtocol"
import {
  getDirectColor,
  getToolColor,
} from "@shared/utils/helperProtocallMethods"
import { DEFAULT_STROKE_SIZE } from "@shared/constants/canvas"

import type {
  BaseInstruction,
  DrawAction,
  DrawInstruction,
  PatchEntry,
} from "@shared/types/drawProtocol"
import type { ColorPallet } from "@shared/types/primitive"
//#endregion

//#region Type Def
export type DrawHandlerMethodStart = (
  da: DrawAction,
  cp: ColorPallet,
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

//#region Settup Method
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
): UseDrawActionsReturn {
  const sessionId = useSessionID()
  const baseInstruction = useRef<BaseInstruction>({
    instructionId: -1,
    sessionId,
  })
  const record = useRef<PatchEntry[]>([])

  const handleDrawActionStart = (
    da: DrawAction,
    cp: ColorPallet,
    ev: PointerEvent,
  ): DrawInstruction | null => {
    const canvas = canvasRef.current
    if (!canvas) {
      return null
    }

    baseInstruction.current.instructionId += 1
    baseInstruction.current.color = getToolColor(
      da.type,
      getDirectColor(cp, ev),
    )
    // Captured once per gesture; motion/leave reuse the same baseInstruction, so
    // the whole stroke draws at one width.
    baseInstruction.current.size = strokeSizeRef?.current ?? DEFAULT_STROKE_SIZE
    record.current = []

    switch (da.type) {
      case "pencil":
      case "eraser":
        return handleDrawLineStart(
          canvas,
          baseInstruction.current,
          da,
          ev,
          record.current,
        )
      case "bucket":
        return handleDrawFillStart(canvas, baseInstruction.current, da, ev)
      case "spray":
        return handleDrawSprayStart(
          canvas,
          baseInstruction.current,
          da,
          ev,
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
          record.current,
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

    if (record.current.length > 0) {
      onCommitAction?.(baseInstruction.current.instructionId, record.current)
      record.current = []
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

    switch (da.type) {
      case "pencil":
      case "eraser":
        return handleDrawLineMotion(
          canvas,
          baseInstruction.current,
          da,
          ev,
          record.current,
        )
      case "bucket":
        return handleDrawFillMotion(canvas, baseInstruction.current, da, ev)
      case "spray":
        return handleDrawSprayMotion(
          canvas,
          baseInstruction.current,
          da,
          ev,
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

    switch (da.type) {
      case "pencil":
      case "eraser":
        return handleDrawLineLeave(
          canvas,
          baseInstruction.current,
          da,
          ev,
          record.current,
        )
      case "bucket":
        return handleDrawFillLeave(canvas, baseInstruction.current, da, ev)
      case "spray":
        return handleDrawSprayLeave(
          canvas,
          baseInstruction.current,
          da,
          ev,
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
