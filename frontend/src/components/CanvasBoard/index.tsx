//#region Imports
import "./styles.css"
//#endregion

//#region Component
export interface CanvasBoardProps {
  canvasRef: React.RefObject<HTMLCanvasElement | null>
}

export default function CanvasBoard({ canvasRef }: CanvasBoardProps) {
  const handleContextMenu = (e: React.MouseEvent<HTMLCanvasElement>) => {
    e.preventDefault()
  }

  return (
    <div className="canvas-wrapper">
      <canvas
        ref={canvasRef}
        className="draw-canvas"
        onContextMenu={handleContextMenu}
      ></canvas>
    </div>
  )
}
//#endregion
