//#region Imports
import { useEffect } from "react"

import { getPosCorrected } from "@shared/utils/helperProtocolMethods"

import type { Vec } from "@shared/types/primitive"
import type { CursorTool } from "@shared/types/socketProtocol"
//#endregion

//#region Constants
// ~22 updates/second. Cursors read as smooth well below the 60fps the overlay
// renders at, and throttling keeps a fast scribble from flooding the socket.
const THROTTLE_MS = 45
//#endregion

//#region Hook
// Broadcasts this client's pointer position over the canvas so others can see
// its cursor. Separate from the drawing pointer handling: it fires on plain
// hover too (you see other people's cursors before they draw), and it sends null
// when the pointer leaves so their cursor disappears.
export default function useCursorBroadcast(
  canvasRef: React.RefObject<HTMLCanvasElement | null>,
  sendCursor: (pos: Vec | null, tool?: CursorTool) => void,
  // A REF, read at send time rather than captured: the tool changes while this
  // effect stays mounted, and re-subscribing the pointer listeners every time
  // someone picks a brush would be pure churn (§13.5).
  toolRef: React.RefObject<CursorTool>,
): void {
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) {
      return
    }

    let lastSent = 0

    const onMove = (ev: PointerEvent) => {
      const now = performance.now()
      if (now - lastSent < THROTTLE_MS) {
        return
      }
      lastSent = now
      // getPosCorrected clamps to the canvas bounds, so a cursor near the edge
      // sticks to the edge rather than reporting an out-of-range coordinate.
      const [pos] = getPosCorrected(ev, canvas)
      sendCursor(pos, toolRef.current)
    }

    const onLeave = () => sendCursor(null)

    canvas.addEventListener("pointermove", onMove)
    canvas.addEventListener("pointerleave", onLeave)
    return () => {
      canvas.removeEventListener("pointermove", onMove)
      canvas.removeEventListener("pointerleave", onLeave)
    }
  }, [canvasRef, sendCursor, toolRef])
}
//#endregion
