import { useEffect, useRef, type RefObject } from "react"

//#region Type Defs
export type OptionalCheckMethod = (ev: PointerEvent) => boolean
export type DragMethod = (ev: PointerEvent) => void

export type MouseButton = "left" | "middle" | "right"
//#endregion

//#region Constants
const BUTTON_MAP: Record<MouseButton, number> = {
  left: 0,
  middle: 1,
  right: 2,
}
//#endregion

//#region Hook Def
export default function useDrag(
  ref: RefObject<HTMLElement | null>,
  optionalCheck: OptionalCheckMethod | undefined = undefined,
  onDragStart: DragMethod | undefined = undefined,
  onDragFinish: DragMethod | undefined = undefined,
  onDragMotion: DragMethod | undefined = undefined,
  onDragLeave: DragMethod | undefined = undefined,
  mouseButtons: MouseButton[] = ["left", "right"],
): void {
  const isDragging = useRef<boolean>(false)
  const pointerId = useRef<number | null>(null)

  useEffect(() => {
    const element = ref.current
    if (!element) {
      return
    }

    const requiredButtons = mouseButtons.map(
      (button: MouseButton) => BUTTON_MAP[button],
    )

    const onDragStartAdditional: EventListener = (evt) => {
      const ev = evt as PointerEvent
      if (pointerId.current !== null || isDragging.current) {
        return
      }
      if (!requiredButtons.includes(ev.button)) {
        return
      }
      if (optionalCheck && !optionalCheck(ev)) {
        return
      }

      pointerId.current = ev.pointerId
      isDragging.current = true

      element.setPointerCapture(ev.pointerId)

      ev.preventDefault()
      onDragStart?.(ev)
    }

    const onDragLeaveAdditional: EventListener = (evt) => {
      const ev = evt as PointerEvent
      if (pointerId.current !== ev.pointerId || !isDragging.current) {
        return
      }

      ev.preventDefault()
      onDragLeave?.(ev)
    }

    const onDragFinishAdditional: EventListener = (evt) => {
      const ev = evt as PointerEvent
      if (pointerId.current !== ev.pointerId || !isDragging.current) {
        return
      }

      pointerId.current = null
      isDragging.current = false

      if (element.hasPointerCapture(ev.pointerId)) {
        element.releasePointerCapture(ev.pointerId)
      }

      ev.preventDefault()
      onDragFinish?.(ev)
    }

    const onDragMotionAdditional: EventListener = (evt) => {
      const ev = evt as PointerEvent
      if (pointerId.current !== ev.pointerId || !isDragging.current) {
        return
      }

      ev.preventDefault()
      onDragMotion?.(ev)
    }

    document.addEventListener("pointercancel", onDragFinishAdditional)

    element.addEventListener("pointerdown", onDragStartAdditional)
    element.addEventListener("pointerleave", onDragLeaveAdditional)
    document.addEventListener("pointerup", onDragFinishAdditional)
    document.addEventListener("pointermove", onDragMotionAdditional)

    return () => {
      element.removeEventListener("pointerdown", onDragStartAdditional)
      element.removeEventListener("pointerleave", onDragLeaveAdditional)
      document.removeEventListener("pointerup", onDragFinishAdditional)
      document.removeEventListener("pointermove", onDragMotionAdditional)
      document.removeEventListener("pointercancel", onDragFinishAdditional)
    }
    // optionalCheck was missing: a caller that changed its predicate (e.g. to
    // gate dragging on a mode) would have kept the listener bound to the old
    // one. Every current caller passes a stable useCallback, so this is a
    // latent bug rather than an active one — but the deps must describe what
    // the effect actually closes over.
  }, [
    ref,
    optionalCheck,
    onDragStart,
    onDragFinish,
    onDragMotion,
    onDragLeave,
    mouseButtons,
  ])
}
//#endregion
