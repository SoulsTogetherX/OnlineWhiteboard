//#region Imports
import type { CanvasDims } from "@shared/constants/canvas"

import "./styles.css"
//#endregion

//#region Component
export interface CanvasBoardProps {
  canvasRef: React.RefObject<HTMLCanvasElement | null>
  // The room's pixel dimensions. Drives the DISPLAY size so pixels stay 1:1:
  // a non-square canvas must be shown as a rectangle, not stretched into the
  // square viewport box.
  dims: CanvasDims
}

// Fit the canvas into a roughly-square viewport box (min(90vw, 80vh)) while
// keeping the pixel aspect ratio, by scaling the LARGER pixel dimension up to the
// box and deriving the other from it. Previously the element was forced square
// regardless of dims, so resizing to e.g. 128×256 squashed the pixels 2:1.
const VIEWPORT_BOX = "min(90vw, 80vh)"

export default function CanvasBoard({ canvasRef, dims }: CanvasBoardProps) {
  const handleContextMenu = (e: React.MouseEvent<HTMLCanvasElement>) => {
    // Right-click is the secondary-color draw gesture (see getDirectColor), so
    // the browser menu must not appear.
    e.preventDefault()
  }

  const displaySize =
    dims.width >= dims.height
      ? {
          width: VIEWPORT_BOX,
          height: `calc(${VIEWPORT_BOX} * ${dims.height} / ${dims.width})`,
        }
      : {
          width: `calc(${VIEWPORT_BOX} * ${dims.width} / ${dims.height})`,
          height: VIEWPORT_BOX,
        }

  return (
    <canvas
      ref={canvasRef}
      className="draw-canvas"
      style={displaySize}
      onContextMenu={handleContextMenu}
      // A <canvas> with no label and no child content is completely opaque to
      // assistive tech — it was announced as nothing at all. `img` is the right
      // role here: the canvas is a rendered picture, not an interactive widget
      // (drawing is pointer-driven and has no keyboard equivalent).
      role="img"
      aria-label="Collaborative drawing canvas"
    >
      {/* Fallback content, surfaced to assistive tech and to browsers that
          cannot render canvas. */}
      The shared whiteboard drawing for this room.
    </canvas>
  )
}
//#endregion
