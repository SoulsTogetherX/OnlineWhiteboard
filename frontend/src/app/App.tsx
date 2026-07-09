//#region Imports
import { useRef, useState } from "react"

import ToolMenu from "@/components/ToolMenu"
import CanvasBoard from "@/components/CanvasBoard"
import RoomPopup from "@/components/Popups/RoomPopup"
import ColorPopup from "@/components/Popups/ColorPopup"
import ColorSelector from "@/components/ColorSelector"
import RoomStatus from "@/components/RoomStatus"

import useCanvasDrawing from "@/hooks/useCanvasDrawing"
import useRoomConnection from "@/hooks/useRoomConnection"
import useColorPalette from "@/hooks/useColorPalette"

import { DEFAULT_DRAW_ACTION } from "@/constants/ui"

import type { DrawAction } from "@shared/types/drawProtocol"
import type { ColorPalletKeys } from "@shared/types/primitive"

import "./styles.css"
import HamburgerButton from "@/components/HamburgerButton"
//#endregion

//#region Page Def
export default function App() {
  // Refs
  const canvasRef = useRef<HTMLCanvasElement>(
    null,
  ) as React.RefObject<HTMLCanvasElement>
  const drawAction = useRef<DrawAction>(DEFAULT_DRAW_ACTION)

  // Tool Bar
  const [isToolbarOpen, setIsToolbarOpen] = useState<boolean>(false)

  // Color
  const [isColorOpen, setIsColorOpen] = useState<boolean>(false)
  const [selectedColor, setSelectedColor] = useState<ColorPalletKeys>("primary")
  const { colorPallet, setColor } = useColorPalette()

  // Room
  const [isRoomOpen, setIsRoomOpen] = useState<boolean>(false)
  const { roomId, activeUsers, socketLabel, sendDrawInstruction, loadRoom } =
    useRoomConnection(canvasRef, () => setIsRoomOpen(false))

  // Drawing Settup
  useCanvasDrawing(canvasRef, drawAction, colorPallet, sendDrawInstruction)

  // Frontend
  return (
    <>
      <div className="background" onClick={() => setIsToolbarOpen(false)} />
      <RoomStatus
        roomId={roomId}
        activeUsers={activeUsers}
        socketLabel={socketLabel}
      />
      <HamburgerButton onClick={() => setIsToolbarOpen(true)} />
      <ToolMenu
        isOpen={isToolbarOpen}
        drawAction={drawAction}
        openRoomPicker={() => setIsRoomOpen(true)}
      />
      <CanvasBoard canvasRef={canvasRef} />
      <ColorSelector
        colorPallet={colorPallet}
        openColorPopup={(primary: boolean) => {
          setSelectedColor(primary ? "primary" : "secondary")
          setIsColorOpen(true)
        }}
        onColorChange={() => {}}
      />
      <ColorPopup
        isOpen={isColorOpen}
        onClose={() => setIsColorOpen(false)}
        currentColor={colorPallet.current["primary"]}
        onApply={(color) => {
          setColor(selectedColor, color)
          setIsColorOpen(false)
        }}
      />
      <RoomPopup
        isOpen={isRoomOpen}
        roomId={roomId}
        onClose={() => setIsRoomOpen(false)}
        onLoad={loadRoom}
      />
    </>
  )
}
//#endregion
