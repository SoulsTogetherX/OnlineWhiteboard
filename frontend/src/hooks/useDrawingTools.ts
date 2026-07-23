//#region Imports
import { useCallback, useRef, useState } from "react"

import { DEFAULT_STABILIZATION } from "@/utils/stabilizer"

import { DEFAULT_DRAW_ACTION, DEFAULT_TOOL } from "@/constants/ui"

import {
  DEFAULT_BLUR_BLEND,
  DEFAULT_BLUR_OPACITY,
  DEFAULT_STROKE_SIZE,
} from "@shared/constants/canvas"

import type { DrawAction, ToolType } from "@shared/types/drawProtocol"
import type { AppTool } from "@/components/SideBar/DrawingTab/tools"
//#endregion

//#region Type Def
export interface UseDrawingToolsResult {
  // Blur brush settings. blend = how far each pixel samples, opacity = how much
  // of the blurred value is mixed in, lockAlpha = leave transparency alone.
  blurSettingsRef: React.RefObject<{
    blend: number
    opacity: number
    lockAlpha: boolean
  }>
  blurBlend: number
  setBlurBlend: (blend: number) => void
  blurOpacity: number
  setBlurOpacity: (opacity: number) => void
  lockAlpha: boolean
  setLockAlpha: (locked: boolean) => void
  // True while the grabber is held, read by the canvas drag handlers.
  grabbingRef: React.RefObject<boolean>
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
  // Spray density (pixels per puff), same ref+state split. Read at gesture start
  // for the spray tool.
  sprayDensityRef: React.RefObject<number>
  sprayDensity: number
  // Stroke smoothing. Same ref+state split as the others (§13.5): the pointer
  // handlers read the ref on every event, the slider renders from the state.
  stabilizationRef: React.RefObject<number>
  stabilization: number
  setSprayDensity: (density: number) => void
  setStabilization: (strength: number) => void
}
//#endregion

//#region Constants
// A middle-of-the-road default puff density (the slider spans 1..MAX_SPRAY_DENSITY
// = 64). Before this the spray had no density control at all.
const DEFAULT_SPRAY_DENSITY = 16
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
  const [selectedTool, setSelectedTool] = useState<AppTool>(DEFAULT_TOOL)

  // The eyedropper is a mode, not a draw action: while it's on, drawing is
  // suppressed (eyedropperActive gates useCanvasDrawing) and a click samples
  // instead. lastDrawTool remembers what to switch back to after a pick.
  const eyedropperActive = useRef<boolean>(false)
  const lastDrawTool = useRef<ToolType>(DEFAULT_DRAW_ACTION.type)

  // Two tools are not ToolTypes and so never become a drawAction:
  //   - eyedropper samples a pixel and reverts.
  //   - grabber draws nothing at all; it changes what dragging the canvas means.
  // Both still need to be the SELECTED tool (the picker, the cursor glyph, the
  // panels all key off that), which is why selection and "what the pointer
  // draws" are separate pieces of state rather than one value.
  // True while the grabber is held, read per-event by the canvas drag handlers.
  // Written in selectTool rather than derived during render, for the same reason
  // as the blur settings above.
  // Seeded from the initial tool, not hardcoded false: the grabber is selected
  // on arrival, and starting this at false would mean the board refused to pan
  // until you picked some other tool and came back.
  const grabbingRef = useRef<boolean>(DEFAULT_TOOL === "grabber")

  const selectTool = useCallback((type: AppTool) => {
    grabbingRef.current = type === "grabber"
    if (type === "eyedropper") {
      eyedropperActive.current = true
    } else if (type === "grabber") {
      // Leave drawAction untouched: picking up the grabber and putting it down
      // again should hand back the brush you had, not reset you to the pencil.
      eyedropperActive.current = false
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

  // Spray density — same ref+state split as stroke size.
  const stabilizationRef = useRef<number>(DEFAULT_STABILIZATION)
  const [stabilization, setStabilizationState] =
    useState<number>(DEFAULT_STABILIZATION)
  const setStabilization = useCallback((strength: number) => {
    stabilizationRef.current = strength
    setStabilizationState(strength)
  }, [])

  const sprayDensityRef = useRef<number>(DEFAULT_SPRAY_DENSITY)
  const [sprayDensity, setSprayDensityState] =
    useState<number>(DEFAULT_SPRAY_DENSITY)
  const setSprayDensity = useCallback((density: number) => {
    sprayDensityRef.current = density
    setSprayDensityState(density)
  }, [])

  // Blur settings. Same ref+state split as everything above (§13.5): the refs are
  // what the pointer handlers read while a gesture runs, the state is what the
  // panel renders.
  // ONE ref holding all three blur settings, not three refs plus a combining
  // step. The pointer handler wants a single deref, and — more importantly — a
  // combined ref assembled during render would be a render-time ref mutation,
  // which React's rules forbid because it makes the value depend on how many
  // times a component happened to render. Mutating inside the setters keeps
  // every write inside an event handler, where it belongs.
  const blurSettingsRef = useRef({
    blend: DEFAULT_BLUR_BLEND,
    opacity: DEFAULT_BLUR_OPACITY,
    lockAlpha: false,
  })

  const [blurBlend, setBlurBlendState] = useState<number>(DEFAULT_BLUR_BLEND)
  const setBlurBlend = useCallback((blend: number) => {
    blurSettingsRef.current = { ...blurSettingsRef.current, blend }
    setBlurBlendState(blend)
  }, [])

  const [blurOpacity, setBlurOpacityState] =
    useState<number>(DEFAULT_BLUR_OPACITY)
  const setBlurOpacity = useCallback((opacity: number) => {
    blurSettingsRef.current = { ...blurSettingsRef.current, opacity }
    setBlurOpacityState(opacity)
  }, [])

  const [lockAlpha, setLockAlphaState] = useState<boolean>(false)
  const setLockAlpha = useCallback((locked: boolean) => {
    blurSettingsRef.current = { ...blurSettingsRef.current, lockAlpha: locked }
    setLockAlphaState(locked)
  }, [])

  return {
    blurSettingsRef,
    blurBlend,
    setBlurBlend,
    blurOpacity,
    setBlurOpacity,
    lockAlpha,
    setLockAlpha,
    grabbingRef,
    drawAction,
    selectedTool,
    selectTool,
    eyedropperActive,
    revertToLastDrawTool,
    strokeSizeRef,
    strokeSize,
    setStrokeSize,
    sprayDensityRef,
    sprayDensity,
    stabilizationRef,
    stabilization,
    setStabilization,
    setSprayDensity,
  }
}
//#endregion
