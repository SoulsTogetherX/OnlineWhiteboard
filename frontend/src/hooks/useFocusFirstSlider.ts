//#region Imports
import { useEffect, type RefObject } from "react"
//#endregion

//#region Hook Def
// Focuses the first range input inside `ref` when the panel appears.
//
// This is what makes "pick a tool, then wheel to size it" work: the canvas wheel
// handler gives the plain wheel to a FOCUSED slider (see useCanvasMotion), and
// the panel mounting is the moment a tool was selected. Focus is also
// self-clearing in the way you would want — drawing moves focus off the slider,
// so the wheel goes back to zooming as soon as you use the brush.
//
// preventScroll because the sidebar is a scroll container: focusing a control
// inside it must not yank the panel to a different scroll position.
export default function useFocusFirstSlider(
  ref: RefObject<HTMLElement | null>,
): void {
  useEffect(() => {
    ref.current
      ?.querySelector<HTMLInputElement>('input[type="range"]')
      ?.focus({ preventScroll: true })
  }, [ref])
}
//#endregion
