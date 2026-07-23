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

// Left and middle. Both still have to satisfy optionalCheck above, so neither
// pans on its own — this only decides WHICH buttons may pan once you are
// already holding shift or the grabber. Middle-only meant shift+drag could never
// pan at all, because the gate allowed it and the button check then refused.
const PAN_BUTTONS: MouseButton[] = ["left", "middle"]
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
  // The board moves for EXACTLY two reasons: shift is held, or the grabber is
  // the selected tool. Nothing else.
  //
  // The middle button used to pan on its own, on the reasoning that it cannot be
  // pressed by accident while drawing. That made it a third, undocumented way to
  // move the canvas with no modifier and no indicator — the board just moved. If
  // there is one rule ("shift or the grabber"), an exception to it is a bug
  // whatever its justification.
  const optionalCheck = useCallback(
    (ev: PointerEvent): boolean => {
      if (!(ev.shiftKey || grabbingRef?.current === true)) {
        return false
      }

      // A pan may only START on the canvas surface or the empty frame background
      // — never on UI chrome.
      //
      // The drag listener is on the frame, which WRAPS the entire app: the
      // sidebar, its buttons, every popup. Consulting only the modifier meant a
      // pointerdown anywhere in that subtree began a pan and preventDefault'd —
      // so with the grabber (which latches "navigating" permanently on) no
      // button, slider or input worked at all. Shift had the same latent bug; it
      // just went unnoticed because nobody holds shift while clicking a button.
      //
      // ev.target tells the two apart with no blocklist to keep in sync: the
      // overlays above the canvas are all pointer-events:none, so a press over
      // the board resolves to the canvas element itself, a press on the bare
      // background resolves to the frame, and a press on any control resolves to
      // that control. Only the first two may pan. Capture makes this a
      // start-only check — once a pan begins on the canvas, the whole drag is
      // routed there regardless of what the pointer later passes over.
      const target = ev.target
      if (target === dragFrameRef.current) {
        return true
      }
      return (
        target instanceof Element && target.classList.contains("draw-canvas")
      )
    },
    [grabbingRef, dragFrameRef],
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
    PAN_BUTTONS,
  )
}
//#endregion
