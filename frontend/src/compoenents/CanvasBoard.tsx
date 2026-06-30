//#region Component
interface CanvasBoardProps {
  canvasRef: React.RefObject<HTMLCanvasElement | null>
}

function CanvasBoard({ canvasRef }: CanvasBoardProps) {
  return (
    <div className="canvas-wrapper">
      <canvas ref={canvasRef} className="draw-canvas"></canvas>
    </div>
  )
}
//#endregion

//#region Exports
export default CanvasBoard
//#endregion
