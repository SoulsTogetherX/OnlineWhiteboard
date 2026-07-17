//#region Imports
import "./styles.css"
//#endregion

//#region Component
export interface CanvasBoardProps {
  canvasRef: React.RefObject<HTMLCanvasElement | null>
}

export default function CanvasBoard({ canvasRef }: CanvasBoardProps) {
  const handleContextMenu = (e: React.MouseEvent<HTMLCanvasElement>) => {
    // Right-click is the secondary-color draw gesture (see getDirectColor), so
    // the browser menu must not appear.
    e.preventDefault()
  }

  return (
    <canvas
      ref={canvasRef}
      className="draw-canvas"
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
