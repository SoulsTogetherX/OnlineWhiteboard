//#region Imports
import { useRef, useState } from "react"

import { defaultColorPallet, defaultDrawAction } from "../constants/ui"

import ToolMenu from "../components/ToolMenu"
import CanvasBoard from "../components/CanvasBoard"
import PaletteHandler from "../components/PaletteHandler"
import RoomPopup from "../components/Popups/RoomPopup"
import ColorPopup from "../components/Popups/ColorPopup"

import useCanvasDrawing from "../hooks/useCanvasDrawing"

import type { DrawAction } from "../types/drawAction"
import type { ColorPallet } from "../types/colorPallet"

import "./styles.css"
//#endregion

//#region Page Methods
function App() {
  const [isNavOpen, setIsNavOpen] = useState<boolean>(false)
  const [isColorOpen, setIsColorOpen] = useState<boolean>(false)
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
      <ColorPopup
        isOpen={isColorOpen}
        onClose={() => setIsColorOpen(false)}
      ></ColorPopup>
      <RoomPopup isOpen={isRoomOpen} onClose={() => setIsRoomOpen(false)} />
    </>
  )
}
//#endregion

//#region Export
export default App
//#endregion
