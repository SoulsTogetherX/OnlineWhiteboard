import { useEffect, type RefObject } from "react"

//#region Type Defs
export type ScrollWheelMethod = (ev: WheelEvent) => void
//#endregion

//#region Hook Def
// Registers a NON-PASSIVE wheel listener so the handler itself decides whether to
// preventDefault — e.g. zoom only on shift+wheel and otherwise let the event
// through so the page (or a focused/hovered control like the stroke-size input)
// scrolls normally instead of the canvas eating every wheel.
export default function useScrollWheel(
  ref: RefObject<HTMLElement | null>,
  onWheel: ScrollWheelMethod | undefined = undefined,
): void {
  useEffect(() => {
    const element = ref.current
    if (!element || !onWheel) {
      return
    }

    const listener: EventListener = (evt) => onWheel(evt as WheelEvent)
    element.addEventListener("wheel", listener, { passive: false })

    return () => {
      element.removeEventListener("wheel", listener)
    }
  }, [ref, onWheel])
}
//#endregion
