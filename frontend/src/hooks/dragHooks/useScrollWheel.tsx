import { useEffect, type RefObject } from "react"

//#region Type Defs
export type ScrollWheelMethod = (ev: WheelEvent) => void
//#endregion

//#region Hook Def
export default function useScrollWheel(
  ref: RefObject<HTMLElement | null>,
  onWheel: ScrollWheelMethod | undefined = undefined,
  preventDefault: boolean = false,
): void {
  useEffect(() => {
    const element = ref.current
    if (!element || !onWheel) {
      return
    }

    const onWheelAdditional: EventListener = (evt) => {
      const ev = evt as WheelEvent
      if (preventDefault) {
        ev.preventDefault()
      }

      onWheel(ev)
    }

    element.addEventListener("wheel", onWheelAdditional, {
      passive: !preventDefault,
    })

    return () => {
      element.removeEventListener("wheel", onWheelAdditional)
    }
  }, [ref, onWheel, preventDefault])
}
//#endregion
