//#region Imports
import { useRef, useState } from "react"

import { defaultColorPallet, defaultDrawAction } from "../constants/ui"

import ToolMenu from "../components/ToolMenu"
import CanvasBoard from "../components/CanvasBoard"
import PaletteHandler from "../components/PaletteHandler"

import useCanvasDrawing from "../hooks/useCanvasDrawing"

import type { DrawAction } from "../types/drawAction"
import type { ColorPallet } from "../types/colorPallet"

import "./styles.css"
import RoomPicker from "../components/Modules/RoomPicker"
//#endregion

//#region Page Methods
function App() {
  const [isNavOpen, setIsNavOpen] = useState<boolean>(false)
  const [isRoomOpen, setIsRoomOpen] = useState<boolean>(false)

  const canvasRef = useRef<HTMLCanvasElement>(null)
  const drawAction = useRef<DrawAction>(defaultDrawAction)
  const colorPallet = useRef<ColorPallet>(defaultColorPallet)

  const openPalletModuleHandler = (isPrimary: boolean) => {}

  useCanvasDrawing(canvasRef, drawAction, colorPallet)
  return (
    <>
      <div className="background" onClick={() => setIsNavOpen(false)}></div>
      <ToolMenu isOpen={isNavOpen} openRoomPicker={() => setIsRoomOpen(true)} />
      <CanvasBoard canvasRef={canvasRef} />
      <PaletteHandler
        colorPallet={colorPallet}
        openPalletModule={openPalletModuleHandler}
      />
      <RoomPicker isOpen={isRoomOpen} onClose={() => setIsRoomOpen(false)} />
    </>
  )
}
//#endregion

//#region Export
export default App
//#endregion
