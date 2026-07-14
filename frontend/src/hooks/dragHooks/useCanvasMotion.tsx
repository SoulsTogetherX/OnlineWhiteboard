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
  }, [])
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
    [dragElementRef],
  )

  const onScrollWheel = useCallback(
    (ev: WheelEvent) => {
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
    [dragElementRef],
  )

  useScrollWheel(dragFrameRef, onScrollWheel, true)
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
