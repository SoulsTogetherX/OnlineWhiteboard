//#region Imports
import "./styles.css"
//#endregion

//#region Component
interface CanvasBoardProps {
  canvasRef: React.RefObject<HTMLCanvasElement | null>
}

function CanvasBoard({ canvasRef }: CanvasBoardProps) {
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

//#region Exports
export type { CanvasBoardProps }
export default CanvasBoard
//#endregion
