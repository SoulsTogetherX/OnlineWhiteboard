//#region Imports
import { useCallback, useEffect, useRef } from "react"

import useScrollWheel from "./useScrollWheel"
import useDrag from "./useDrag"

import {
  installRecentSliderTracking,
  nudgeSlider,
  recentSlider,
} from "@/utils/recentSlider"
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
// The pan/zoom variables are written to the FRAME, not to the canvas, even
// though it is the canvas that carries the transform reading them.
//
// Custom properties inherit, so anything inside the frame sees the same values —
// which is what keeps the canvas and the brush-preview overlay stacked on top of
// it in exact alignment. Setting them on the canvas element (as this used to)
// meant the overlay, a sibling, kept the fallbacks: it never panned and never
// zoomed, so the outline drifted away from the pointer the moment the board was
// moved. Any future layer over the canvas gets the alignment for free now.
export default function useCanvasMotion(
  dragFrameRef: React.RefObject<HTMLElement | null>,
  dragElementRef: React.RefObject<HTMLElement | null>,
  // True while the grabber tool is held. A ref, not a value: the drag listeners
  // read it on every event, and threading it as state would re-subscribe them
  // each time the tool changed.
  grabbingRef?: React.RefObject<boolean>,
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

    dragFrameRef.current?.style.setProperty(POS_X_KEY, `${offset.current.x}px`)
    dragFrameRef.current?.style.setProperty(POS_Y_KEY, `${offset.current.y}px`)
  }, [dragElementRef, dragFrameRef])
  // Panning requires SHIFT — the same modifier that enables zooming, so one key
  // means "navigate" and nothing moves the board by accident. The middle button
  // still works on its own because it cannot be pressed by accident while
  // drawing, and it is the conventional pan gesture.
  //
  // The grabber tool is the third way in, and it is the reason the tool exists:
  // holding a modifier to move the canvas is fine for a quick nudge and tiring
  // for a long one, especially on a trackpad or a tablet where shift may be a
  // second hand away. Selecting the grabber makes dragging pan outright.
  const optionalCheck = useCallback(
    (ev: PointerEvent): boolean => {
      return ev.shiftKey || ev.buttons === 4 || grabbingRef?.current === true
    },
    [grabbingRef],
  )

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
      const frame = dragFrameRef.current
      if (!frame) {
        return
      }

      const dx = ev.clientX - dragStart.current.pointerX
      const dy = ev.clientY - dragStart.current.pointerY

      offset.current = {
        x: dragStart.current.offsetX + dx,
        y: dragStart.current.offsetY + dy,
      }

      frame.style.setProperty(POS_X_KEY, `${offset.current.x}px`)
      frame.style.setProperty(POS_Y_KEY, `${offset.current.y}px`)
      checkResetPos()
    },
    [dragFrameRef, checkResetPos],
  )

  const onScrollWheel = useCallback(
    (ev: WheelEvent) => {
      // Shift is the canvas modifier: shift+wheel zooms the board, and a bare
      // wheel belongs to the tool — it adjusts the slider you were last working
      // with, so you can size a brush, try it, and size it again without ever
      // going back to the sidebar.
      //
      // "Last worked with" rather than "currently focused" is what makes that
      // usable: clicking the canvas to draw takes focus off the slider, so a
      // focus-based rule worked exactly once per visit to the panel.
      //
      // With no remembered slider the wheel is left completely alone — the board
      // still never moves on its own.
      // The grabber zooms on a bare wheel too. Holding it means "I am navigating
      // right now", and a tool with no sliders has nothing else for the wheel to
      // do — requiring shift as well would be asking for a modifier to confirm
      // the mode you already selected.
      if (!ev.shiftKey && grabbingRef?.current !== true) {
        const slider = recentSlider()
        if (slider) {
          ev.preventDefault()
          nudgeSlider(slider, ev.deltaY < 0 ? 1 : -1)
        }
        return
      }
      ev.preventDefault()

      const frame = dragFrameRef.current
      if (!frame) {
        return
      }

      const zoomFactor = 1 + ZOOM_SENSITIVITY * scale.current
      scale.current =
        ev.deltaY < 0
          ? Math.min(MAX_ZOOM, scale.current * zoomFactor)
          : Math.max(MIN_ZOOM, scale.current / zoomFactor)
      frame.style.setProperty(SCROLL_KEY, `${scale.current}`)
      checkResetPos()
    },
    [dragFrameRef, checkResetPos, grabbingRef],
  )

  // Start watching for slider interaction as soon as the board exists, so the
  // very first wheel already knows which slider you were last using.
  useEffect(() => {
    installRecentSliderTracking()
  }, [])

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
