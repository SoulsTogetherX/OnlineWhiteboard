//#region Imports
import { useEffect } from "react"

import {
  getCanvasState,
  getIdxFromVec,
  getPosCorrected,
} from "@shared/utils/helperProtocolMethods"

import type { ColorType } from "@shared/types/primitive"
//#endregion

//#region Hook
// Samples the colour of the canvas pixel under a click while the eyedropper is
// active. Reads straight from the canvas's ImageData — the same buffer the
// drawing code writes — so no extra rendering or round-trip is needed.
//
// `active` is a ref, not a prop, so toggling the tool doesn't re-subscribe the
// listener (matching how the drawing hooks read the current tool at event time).
export default function useEyedropper(
  canvasRef: React.RefObject<HTMLCanvasElement | null>,
  active: React.RefObject<boolean>,
  onPick: (color: ColorType) => void,
): void {
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) {
      return
    }

    const onPointerDown = (ev: PointerEvent) => {
      if (!active.current) {
        return
      }
      const canvasState = getCanvasState(canvas)
      if (!canvasState) {
        return
      }
      const [pos] = getPosCorrected(ev, canvas)
      const idx = getIdxFromVec(pos)
      const data = canvasState.imageData.data
      onPick({
        r: data[idx],
        g: data[idx + 1],
        b: data[idx + 2],
        a: data[idx + 3],
      })
    }

    canvas.addEventListener("pointerdown", onPointerDown)
    return () => canvas.removeEventListener("pointerdown", onPointerDown)
  }, [canvasRef, active, onPick])
}
//#endregion
