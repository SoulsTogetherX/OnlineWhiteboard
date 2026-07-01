//#region Imports
import { useRef, useState } from "react"

import { defaultColorPallet, defaultDrawAction } from "../constants/ui"

import NavMenu from "../compoenents/NavMenu"
import CanvasBoard from "../compoenents/CanvasBoard"
import useCanvasDrawing from "../hooks/useCanvasDrawing"
import NavMenuButton from "../compoenents/NavMenuButton"

import type { DrawAction } from "../types/drawAction"

import "./styles.css"
import type { ColorPallet } from "../types/colorPallet"
//#endregion

//#region Page Methods
function App() {
  const [isNavOpen, setIsNavOpen] = useState<boolean>(false)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const drawAction = useRef<DrawAction>(defaultDrawAction)
  const colorPallet = useRef<ColorPallet>(defaultColorPallet)

  useCanvasDrawing(canvasRef, drawAction, colorPallet)

  return (
    <>
      <div className="background" onClick={() => setIsNavOpen(false)}></div>
      <NavMenuButton onClick={() => setIsNavOpen(!isNavOpen)} />
      <NavMenu isOpen={isNavOpen} />
      <CanvasBoard canvasRef={canvasRef} />
      <div className="color-picker-module"></div>
      <div className="room-picker-module"></div>
      <div className="loading-screen"></div>
    </>
  )
}
//#endregion

//#region Export
export default App
//#endregion
