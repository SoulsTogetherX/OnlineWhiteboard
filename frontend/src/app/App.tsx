//#region Imports
import { useCallback, useEffect, useRef, useState } from "react"

import ToolMenu from "@/components/ToolMenu"
import CanvasBoard from "@/components/CanvasBoard"
import RoomPopup from "@/components/Popups/RoomPopup"
import ColorPopup from "@/components/Popups/ColorPopup"
import ColorSelector from "@/components/ColorSelector"
import RoomStatus from "@/components/RoomStatus"
import HamburgerButton from "@/components/HamburgerButton"

import useCanvasMotion from "@/hooks/dragHooks/useCanvasMotion"
import useCanvasDrawing from "@/hooks/dragHooks/useCanvasDrawing"
import useRoomConnection from "@/hooks/useRoomConnection"
import useColorPalette from "@/hooks/useColorPalette"
import useUndoRedo from "@/hooks/useUndoRedo"
import useMediaQuery from "@/hooks/useMediaQuery"

import { DEFAULT_DRAW_ACTION, DESKTOP_MEDIA_QUERY } from "@/constants/ui"

import type { DrawAction, ToolType } from "@shared/types/drawProtocol"
import type { ColorPalletKeys } from "@shared/types/primitive"

import "./styles.css"
//#endregion

//#region Page Def
export default function App() {
  // Refs
  const frameRef = useRef<HTMLDivElement>(
    null,
  ) as React.RefObject<HTMLDivElement>
  const canvasRef = useRef<HTMLCanvasElement>(
    null,
  ) as React.RefObject<HTMLCanvasElement>
  const drawAction = useRef<DrawAction>(DEFAULT_DRAW_ACTION)

  // Tool Bar
  // On desktop the toolbar is permanently visible, so `isToolbarOpen` only
  // governs the mobile slide-out. Deriving one `isToolbarVisible` boolean keeps
  // React and the CSS from disagreeing (see useMediaQuery for why that mattered).
  const isDesktop = useMediaQuery(DESKTOP_MEDIA_QUERY)
  const [isToolbarOpen, setIsToolbarOpen] = useState<boolean>(false)
  const isToolbarVisible = isDesktop || isToolbarOpen

  // The selected tool is kept in BOTH a ref and state, deliberately:
  //   - the ref is what the pointer handlers read on every event, so changing
  //     tools never re-subscribes the drag listeners;
  //   - the state is what lets the toolbar render which tool is active.
  // Keeping the pair here, in one place, is what lets ToolMenu stay a plain
  // presentational component instead of writing to a ref it was handed.
  const [selectedTool, setSelectedTool] = useState<ToolType>(
    DEFAULT_DRAW_ACTION.type,
  )
  const selectTool = useCallback((type: ToolType) => {
    drawAction.current = { type }
    setSelectedTool(type)
  }, [])

  // Color
  const [isColorOpen, setIsColorOpen] = useState<boolean>(false)
  const [selectedColor, setSelectedColor] = useState<ColorPalletKeys>("primary")
  const { colorPallet, setColor, swapColors } = useColorPalette()

  // Room
  const [isRoomOpen, setIsRoomOpen] = useState<boolean>(false)
  const { roomId, activeUsers, socketLabel, sendDrawInstruction, loadRoom } =
    useRoomConnection(canvasRef, () => setIsRoomOpen(false))

  // Undo/Redo
  const { pushAction, undo, redo, canUndo, canRedo, notice } = useUndoRedo(
    canvasRef,
    sendDrawInstruction,
  )

  // Canvas Settup
  useCanvasMotion(frameRef, canvasRef)
  useCanvasDrawing(
    canvasRef,
    drawAction,
    colorPallet,
    sendDrawInstruction,
    pushAction,
  )

  // Keyboard shortcuts (desktop only — mobile uses the toolbar buttons)
  useEffect(() => {
    const onKeyDown = (ev: KeyboardEvent) => {
      const isModified = ev.ctrlKey || ev.metaKey
      if (!isModified || ev.key.toLowerCase() !== "z") {
        return
      }
      ev.preventDefault()
      if (ev.shiftKey) {
        redo()
      } else {
        undo()
      }
    }

    window.addEventListener("keydown", onKeyDown)
    return () => window.removeEventListener("keydown", onKeyDown)
  }, [undo, redo])

  // Frontend
  return (
    <div
      ref={frameRef}
      className="app-wrapper"
      onClick={() => setIsToolbarOpen(false)}
    >
      <RoomStatus
        roomId={roomId}
        activeUsers={activeUsers}
        socketLabel={socketLabel}
      />
      <HamburgerButton
        isOpen={isToolbarOpen}
        onClick={() => setIsToolbarOpen((open) => !open)}
      />
      <ToolMenu
        isOpen={isToolbarVisible}
        selectedTool={selectedTool}
        onSelectTool={selectTool}
        openRoomPicker={() => setIsRoomOpen(true)}
        onUndo={undo}
        onRedo={redo}
        canUndo={canUndo}
        canRedo={canRedo}
      />
      <CanvasBoard canvasRef={canvasRef} />
      {notice && <div className="undo-notice">{notice}</div>}
      <ColorSelector
        colorPallet={colorPallet}
        onSwap={swapColors}
        openColorPopup={(primary: boolean) => {
          setSelectedColor(primary ? "primary" : "secondary")
          setIsColorOpen(true)
        }}
      />
      <ColorPopup
        isOpen={isColorOpen}
        onClose={() => setIsColorOpen(false)}
        // Was hardcoded to "primary": opening the secondary swatch showed
        // primary's channels, and Apply then wrote those values into secondary.
        currentColor={colorPallet.current[selectedColor]}
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
    </div>
  )
}
//#endregion
