//#region Imports
import { useCallback, useEffect, useRef, useState } from "react"

import ToolMenu from "@/components/ToolMenu"
import type { AppTool } from "@/components/ToolMenu"
import CanvasBoard from "@/components/CanvasBoard"
import CursorOverlay from "@/components/CursorOverlay"
import RoomPopup from "@/components/Popups/RoomPopup"
import MembersPopup from "@/components/Popups/MembersPopup"
import ColorPopup from "@/components/Popups/ColorPopup"
import ColorSelector from "@/components/ColorSelector"
import RoomStatus from "@/components/RoomStatus"
import PresenceRoster from "@/components/PresenceRoster"
import Dashboard from "@/components/Dashboard"
import CheckpointsPopup from "@/components/Popups/CheckpointsPopup"
import PlaybackViewer from "@/components/PlaybackViewer"
import HamburgerButton from "@/components/HamburgerButton"
import AuthControl from "@/components/AuthControl"
import AuthPopup from "@/components/Popups/AuthPopup"

import useCanvasMotion from "@/hooks/dragHooks/useCanvasMotion"
import useCanvasDrawing from "@/hooks/dragHooks/useCanvasDrawing"
import useRoomConnection from "@/hooks/useRoomConnection"
import useColorPalette from "@/hooks/useColorPalette"
import useUndoRedo from "@/hooks/useUndoRedo"
import useMediaQuery from "@/hooks/useMediaQuery"
import useAuth from "@/hooks/useAuth"
import useCursorBroadcast from "@/hooks/useCursorBroadcast"
import useRecentColors from "@/hooks/useRecentColors"
import useSavedColors from "@/hooks/useSavedColors"
import useEyedropper from "@/hooks/useEyedropper"

import { DEFAULT_DRAW_ACTION, DESKTOP_MEDIA_QUERY } from "@/constants/ui"
import { colorToHex8 } from "@/utils/color"
import { downloadCanvasImage } from "@/utils/downloadImage"
import { DEFAULT_STROKE_SIZE } from "@shared/constants/canvas"

import { canDraw, hasEditAuthority } from "@shared/types/identity"

import type { DrawAction, ToolType } from "@shared/types/drawProtocol"
import type { ColorPaletteKeys, ColorType } from "@shared/types/primitive"

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
  const [selectedTool, setSelectedTool] = useState<AppTool>(
    DEFAULT_DRAW_ACTION.type,
  )
  // The eyedropper is a mode, not a draw action: while it's on, drawing is
  // suppressed (eyedropperActive gates useCanvasDrawing) and a click samples
  // instead. lastDrawTool remembers what to switch back to after a pick.
  const eyedropperActive = useRef<boolean>(false)
  const lastDrawTool = useRef<ToolType>(DEFAULT_DRAW_ACTION.type)
  const selectTool = useCallback((type: AppTool) => {
    if (type === "eyedropper") {
      eyedropperActive.current = true
    } else {
      lastDrawTool.current = type
      eyedropperActive.current = false
      drawAction.current = { type }
    }
    setSelectedTool(type)
  }, [])

  // Stroke size. The ref is what the pointer handlers read at gesture start; the
  // state drives the slider. Same ref+state split as the tool selection.
  const strokeSizeRef = useRef<number>(DEFAULT_STROKE_SIZE)
  const [strokeSize, setStrokeSizeState] = useState<number>(DEFAULT_STROKE_SIZE)
  const setStrokeSize = useCallback((size: number) => {
    strokeSizeRef.current = size
    setStrokeSizeState(size)
  }, [])

  // View-only lock, read by the pointer handlers. A viewer's drawing is blocked
  // client-side (the server enforces it too) so strokes don't flash and revert.
  const viewOnlyRef = useRef<boolean>(false)

  // Auth
  const { user, isLoading: authLoading, login, register, logout } = useAuth()
  const [isAuthOpen, setIsAuthOpen] = useState<boolean>(false)

  // Color
  const [isColorOpen, setIsColorOpen] = useState<boolean>(false)
  const [selectedColor, setSelectedColor] = useState<ColorPaletteKeys>("primary")
  const { colorPalette, setColor, swapColors } = useColorPalette()
  const { recent, addRecent } = useRecentColors()
  const { saved, addSaved, removeSaved } = useSavedColors(user)

  // Room
  const [isRoomOpen, setIsRoomOpen] = useState<boolean>(false)
  const [isMembersOpen, setIsMembersOpen] = useState<boolean>(false)
  const [isDashboardOpen, setIsDashboardOpen] = useState<boolean>(false)
  const [isCheckpointsOpen, setIsCheckpointsOpen] = useState<boolean>(false)
  const {
    roomId,
    participants,
    self,
    socketLabel,
    sendDrawInstruction,
    loadRoom,
    sendCursor,
    settings,
    clearCanvas,
    checkpoints,
    createCheckpoint,
    restoreCheckpoint,
    deleteCheckpoint,
    requestPlayback,
    playback,
    clearPlayback,
    cursorsRef,
    cursorIds,
  } = useRoomConnection(canvasRef, () => setIsRoomOpen(false), user?.id ?? null)

  // Undo/Redo
  const { pushAction, undo, redo, canUndo, canRedo, notice } = useUndoRedo(
    canvasRef,
    sendDrawInstruction,
  )

  // Eyedropper: sample a canvas pixel into the primary color, then revert to the
  // last drawing tool. Defined here because it needs the palette and recent-color
  // setters as well as the tool selection.
  const onEyedropperPick = useCallback(
    (color: ColorType) => {
      setColor("primary", color)
      addRecent(colorToHex8(color))
      selectTool(lastDrawTool.current)
    },
    [setColor, addRecent, selectTool],
  )

  // Canvas Setup
  useCanvasMotion(frameRef, canvasRef)
  // Keep the drawing lock in step with this connection's role AND the room's
  // open-editing setting. Uses the shared canDraw rule rather than re-testing
  // roles inline, so the client's drawing lock and the server's rejection path
  // can never disagree about who is allowed to draw.
  //
  // Reacts to settings.openEditing too, so an owner turning editing off locks
  // everyone else's tools on the next broadcast — no reconnect needed.
  const isReadOnly = !canDraw(self?.role ?? "guest", settings.openEditing)
  useEffect(() => {
    viewOnlyRef.current = isReadOnly
  }, [isReadOnly])

  useCanvasDrawing(
    canvasRef,
    drawAction,
    colorPalette,
    sendDrawInstruction,
    pushAction,
    eyedropperActive,
    strokeSizeRef,
    viewOnlyRef,
  )
  useEyedropper(canvasRef, eyedropperActive, onEyedropperPick)
  useCursorBroadcast(canvasRef, sendCursor)

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
      <RoomStatus roomId={roomId} socketLabel={socketLabel} />
      <PresenceRoster
        participants={participants}
        selfConnectionId={self?.connectionId ?? null}
      />
      {/* History is available to everyone — replay is read-only. */}
      <button
        type="button"
        className="history-button"
        onClick={() => setIsCheckpointsOpen(true)}
      >
        History
      </button>
      {user && (
        <>
          <button
            type="button"
            className="members-button"
            onClick={() => setIsMembersOpen(true)}
          >
            Members
          </button>
          <button
            type="button"
            className="my-rooms-button"
            onClick={() => setIsDashboardOpen(true)}
          >
            My Rooms
          </button>
        </>
      )}
      <AuthControl
        user={user}
        isLoading={authLoading}
        onOpenAuth={() => setIsAuthOpen(true)}
        onLogout={logout}
      />
      <HamburgerButton
        isOpen={isToolbarOpen}
        onClick={() => setIsToolbarOpen((open) => !open)}
      />
      <ToolMenu
        isOpen={isToolbarVisible}
        selectedTool={selectedTool}
        onSelectTool={selectTool}
        strokeSize={strokeSize}
        onStrokeSizeChange={setStrokeSize}
        openRoomPicker={() => setIsRoomOpen(true)}
        onClear={clearCanvas}
        onDownload={() => {
          if (canvasRef.current) {
            downloadCanvasImage(canvasRef.current, roomId)
          }
        }}
        onUndo={undo}
        onRedo={redo}
        canUndo={canUndo}
        canRedo={canRedo}
      />
      <CanvasBoard canvasRef={canvasRef} />
      <CursorOverlay
        canvasRef={canvasRef}
        cursorsRef={cursorsRef}
        cursorIds={cursorIds}
        participants={participants}
      />
      {notice && <div className="undo-notice">{notice}</div>}
      <ColorSelector
        colorPalette={colorPalette}
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
        currentColor={colorPalette.current[selectedColor]}
        onApply={(color) => {
          setColor(selectedColor, color)
          addRecent(colorToHex8(color))
          setIsColorOpen(false)
        }}
        recent={recent}
        saved={saved}
        onSaveColor={addSaved}
        onRemoveSavedColor={removeSaved}
      />
      <RoomPopup
        isOpen={isRoomOpen}
        roomId={roomId}
        onClose={() => setIsRoomOpen(false)}
        onLoad={loadRoom}
      />
      <MembersPopup
        isOpen={isMembersOpen}
        roomId={roomId}
        onClose={() => setIsMembersOpen(false)}
      />
      <Dashboard
        isOpen={isDashboardOpen}
        currentRoomId={roomId}
        onClose={() => setIsDashboardOpen(false)}
        onOpenRoom={(nextRoomId) => {
          loadRoom(nextRoomId)
          setIsDashboardOpen(false)
        }}
      />
      <CheckpointsPopup
        isOpen={isCheckpointsOpen}
        checkpoints={checkpoints}
        canEdit={hasEditAuthority(self?.role ?? "guest")}
        onClose={() => setIsCheckpointsOpen(false)}
        onCreate={createCheckpoint}
        onRestore={restoreCheckpoint}
        onDelete={deleteCheckpoint}
        onReplay={(id) => {
          requestPlayback(id)
          setIsCheckpointsOpen(false)
        }}
      />
      <PlaybackViewer playback={playback} onClose={clearPlayback} />
      <AuthPopup
        isOpen={isAuthOpen}
        onClose={() => setIsAuthOpen(false)}
        onLogin={login}
        onRegister={register}
      />
    </div>
  )
}
//#endregion
