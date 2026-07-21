//#region Imports
import { useCallback, useRef, useState } from "react"

import { DEFAULT_DRAW_ACTION } from "@/constants/ui"

import { DEFAULT_STROKE_SIZE } from "@shared/constants/canvas"

import type { DrawAction, ToolType } from "@shared/types/drawProtocol"
import type { AppTool } from "@/components/SideBar/DrawingTab/tools"
//#endregion

//#region Type Def
export interface UseDrawingToolsResult {
  // The live draw action, read by the pointer handlers on every event (§13.5) —
  // a ref so switching tools never re-subscribes the drag listeners.
  drawAction: React.RefObject<DrawAction>
  // Parallel state so the Drawing tab can render which tool is active.
  selectedTool: AppTool
  // Switches the active tool; arms the eyedropper's sampling mode.
  selectTool: (type: AppTool) => void
  // True while the eyedropper is armed; gates useCanvasDrawing and useEyedropper.
  eyedropperActive: React.RefObject<boolean>
  // Switch back to the tool that was active before the eyedropper was picked.
  revertToLastDrawTool: () => void
  // Brush diameter, read at gesture start (ref), with a parallel value for the
  // slider — same ref-vs-state split as the tool selection.
  strokeSizeRef: React.RefObject<number>
  strokeSize: number
  setStrokeSize: (size: number) => void
}
//#endregion

//#region Hook Def
// The tool / stroke / eyedropper cluster lifted out of App. The ref-vs-state
// splits are deliberate (§13.5): drawAction, eyedropperActive, lastDrawTool and
// strokeSizeRef are read by the pointer handlers on every event, so changing a
// tool or the brush size never re-subscribes the drag listeners; the parallel
// `selectedTool` / `strokeSize` state exists only so the Drawing tab re-renders.
export default function useDrawingTools(): UseDrawingToolsResult {
  const drawAction = useRef<DrawAction>(DEFAULT_DRAW_ACTION)

  // The selected tool is kept in BOTH a ref (drawAction) and state, deliberately:
  //   - the ref is what the pointer handlers read on every event, so changing
  //     tools never re-subscribes the drag listeners;
  //   - the state is what lets the Drawing tab render which tool is active.
  const [selectedTool, setSelectedTool] = useState<AppTool>(
    DEFAULT_DRAW_ACTION.type,
  )

  // The eyedropper is a mode, not a draw action: while it's on, drawing is
  // suppressed (eyedropperActive gates useCanvasDrawing) and a click samples
  // instead. lastDrawTool remembers what to switch back to after a pick.
  const eyedropperActive = useRef<boolean>(false)
  const lastDrawTool = useRef<ToolType>(DEFAULT_DRAW_ACTION.type)

  const selectTool = useCallback((type: AppTool) => {
    if (type === "eyedropper") {
      eyedropperActive.current = true
    } else {
      lastDrawTool.current = type
      eyedropperActive.current = false
      drawAction.current = { type }
    }
    setSelectedTool(type)
  }, [])

  const revertToLastDrawTool = useCallback(() => {
    selectTool(lastDrawTool.current)
  }, [selectTool])

  // Stroke size. The ref is what the pointer handlers read at gesture start; the
  // state drives the slider. Same ref+state split as the tool selection.
  const strokeSizeRef = useRef<number>(DEFAULT_STROKE_SIZE)
  const [strokeSize, setStrokeSizeState] = useState<number>(DEFAULT_STROKE_SIZE)
  const setStrokeSize = useCallback((size: number) => {
    strokeSizeRef.current = size
    setStrokeSizeState(size)
  }, [])

  return {
    drawAction,
    selectedTool,
    selectTool,
    eyedropperActive,
    revertToLastDrawTool,
    strokeSizeRef,
    strokeSize,
    setStrokeSize,
  }
}
//#endregion
