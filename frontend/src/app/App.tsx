//#region Imports
import { useRef, useState } from "react"

import { defaultDrawInfo } from "../constants/ui"

import NavMenu from "../compoenents/NavMenu"
import CanvasBoard from "../compoenents/CanvasBoard"
import useCanvasDrawing from "../hooks/useCanvasDrawing"

import type drawOptions from "../types/drawOption"

import "./styles.css"
//#endregion

//#region Page Methods
function App() {
  const [isNavOpen, setIsNavOpen] = useState<boolean>(false)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const drawInfo = useRef<drawOptions>(defaultDrawInfo)

  useCanvasDrawing(canvasRef, drawInfo)

  return (
    <>
      <div className="background" onClick={() => setIsNavOpen(false)}></div>
      <button
        className="nav-menu-button"
        onClick={() => setIsNavOpen(!isNavOpen)}
      ></button>
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
