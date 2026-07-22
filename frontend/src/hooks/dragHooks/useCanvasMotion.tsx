//#region Imports
import { useCallback, useRef } from "react"

import useScrollWheel from "./useScrollWheel"
import useDrag from "./useDrag"
import type { MouseButton } from "./useDrag"
//#endregion

//#region Constants
// Property Keys
const POS_X_KEY = "--drag-pos-x"
const POS_Y_KEY = "--drag-pos-y"
const SCROLL_KEY = "--scroll-scale"

// Zoom settings
const ZOOM_SENSITIVITY = 0.1
const MAX_ZOOM = 10
const MIN_ZOOM = 0.6

const MIDDLE_BUTTON_ONLY: MouseButton[] = ["middle"]
//#endregion

//#region Focused-slider helpers
// The range input that currently holds focus, if any. Only a range counts: a
// text field also takes focus, but a wheel means nothing to it, so stealing the
// wheel there would just break zooming while someone typed a room name.
function focusedSlider(): HTMLInputElement | null {
  const active = document.activeElement
  return active instanceof HTMLInputElement && active.type === "range"
    ? active
    : null
}

// Steps a slider by one of its own increments and tells React about it.
//
// stepUp/stepDown rather than arithmetic: they already respect the input's step,
// min and max, so the wheel moves the control by exactly what a keyboard arrow
// would. The "input" event is what React's change tracking listens for — it
// compares the DOM value against the last value it wrote, sees the difference,
// and runs onChange, so the controlled state stays the source of truth.
function nudgeSlider(slider: HTMLInputElement, direction: 1 | -1): void {
  if (direction > 0) {
    slider.stepUp()
  } else {
    slider.stepDown()
  }
  slider.dispatchEvent(new Event("input", { bubbles: true }))
}
//#endregion

//#region Hook Def
export default function useCanvasMotion(
  dragFrameRef: React.RefObject<HTMLElement | null>,
  dragElementRef: React.RefObject<HTMLElement | null>,
): void {
  const offset = useRef({ x: 0, y: 0 })
  const scale = useRef(1)
  const dragStart = useRef({ pointerX: 0, pointerY: 0, offsetX: 0, offsetY: 0 })

  const checkResetPos = useCallback((): void => {
    const element = dragElementRef.current
    if (!element) {
      return
    }
    const rect = element.getBoundingClientRect()

    const viewWidth = window.innerWidth || document.documentElement.clientWidth
    const viewHeight =
      window.innerHeight || document.documentElement.clientHeight

    if (
      rect.bottom >= 0 &&
      rect.top <= viewHeight &&
      rect.right >= 0 &&
      rect.left <= viewWidth
    ) {
      return
    }

    offset.current = {
      x: 0,
      y: 0,
    }

    element.style.setProperty(POS_X_KEY, `${offset.current.x}px`)
    element.style.setProperty(POS_Y_KEY, `${offset.current.y}px`)
  }, [dragElementRef])
  const optionalCheck = useCallback((ev: PointerEvent): boolean => {
    return ev.buttons === 4
  }, [])

  const onDragStart = useCallback((ev: PointerEvent) => {
    dragStart.current = {
      pointerX: ev.clientX,
      pointerY: ev.clientY,
      offsetX: offset.current.x,
      offsetY: offset.current.y,
    }
  }, [])

  const onDragMotion = useCallback(
    (ev: PointerEvent) => {
      const element = dragElementRef.current
      if (!element) {
        return
      }

      const dx = ev.clientX - dragStart.current.pointerX
      const dy = ev.clientY - dragStart.current.pointerY

      offset.current = {
        x: dragStart.current.offsetX + dx,
        y: dragStart.current.offsetY + dy,
      }

      element.style.setProperty(POS_X_KEY, `${offset.current.x}px`)
      element.style.setProperty(POS_Y_KEY, `${offset.current.y}px`)
      checkResetPos()
    },
    [dragElementRef, checkResetPos],
  )

  const onScrollWheel = useCallback(
    (ev: WheelEvent) => {
      // A plain wheel zooms the canvas — that is what a wheel means on a board.
      //
      // The exception is a FOCUSED slider. Selecting a tool focuses its size
      // slider, so right after picking a brush the wheel is the fastest way to
      // size it, wherever the pointer happens to be. While that slider holds
      // focus the plain wheel belongs to it, and shift+wheel zooms instead.
      //
      // Focus, not hover, is what decides: it is the one signal that survives
      // the pointer being over the canvas, which is exactly where you are when
      // you want to adjust a brush and see the result.
      const slider = focusedSlider()
      if (slider && !ev.shiftKey) {
        ev.preventDefault()
        nudgeSlider(slider, ev.deltaY < 0 ? 1 : -1)
        return
      }
      ev.preventDefault()

      const element = dragElementRef.current
      if (!element) {
        return
      }

      const zoomFactor = 1 + ZOOM_SENSITIVITY * scale.current
      scale.current =
        ev.deltaY < 0
          ? Math.min(MAX_ZOOM, scale.current * zoomFactor)
          : Math.max(MIN_ZOOM, scale.current / zoomFactor)
      element.style.setProperty(SCROLL_KEY, `${scale.current}`)
      checkResetPos()
    },
    [dragElementRef, checkResetPos],
  )

  useScrollWheel(dragFrameRef, onScrollWheel)
  useDrag(
    dragFrameRef,
    optionalCheck,
    onDragStart,
    undefined,
    onDragMotion,
    undefined,
    MIDDLE_BUTTON_ONLY,
  )
}
//#endregion
