//#region Imports
import { useCallback, useEffect, useRef, useState } from "react"

import CanvasBoard from "@/components/CanvasBoard"
import CursorOverlay from "@/components/CursorOverlay"
import RoomPopup from "@/components/Popups/RoomPopup"
import MembersPopup from "@/components/Popups/MembersPopup"
import ColorPopup from "@/components/Popups/ColorPopup"
import RoomStatus from "@/components/RoomStatus"
import Dashboard from "@/components/Dashboard"
import PlaybackViewer from "@/components/PlaybackViewer"
import AuthControl from "@/components/AuthControl"
import AuthPopup from "@/components/Popups/AuthPopup"
import SideBar from "@/components/SideBar"
import type { TabId } from "@/components/SideBar"
import RoomTab from "@/components/SideBar/RoomTab"
import DrawingTab from "@/components/SideBar/DrawingTab"
import TimelineTab from "@/components/SideBar/TimelineTab"
import type { AppTool } from "@/components/SideBar/DrawingTab/tools"

import useCanvasMotion from "@/hooks/dragHooks/useCanvasMotion"
import useCanvasDrawing from "@/hooks/dragHooks/useCanvasDrawing"
import useRoomConnection from "@/hooks/useRoomConnection"
import useColorPalette from "@/hooks/useColorPalette"
import useUndoRedo from "@/hooks/useUndoRedo"
import useMediaQuery from "@/hooks/useMediaQuery"
import useAuth from "@/hooks/useAuth"
import useCursorBroadcast from "@/hooks/useCursorBroadcast"
import useCursorPreferences from "@/hooks/useCursorPreferences"
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

  // The right sidebar (Phase 5) is the only tool surface now — the old floating
  // toolbar is gone. `isDesktop` is still read (synchronously, so it's correct
  // on first render) to choose the sidebar's initial open state.
  const isDesktop = useMediaQuery(DESKTOP_MEDIA_QUERY)

  // The right sidebar. Retractable on both desktop and mobile via a single flag
  // the handle toggles. It starts open on desktop and collapsed on mobile so a
  // phone-sized canvas isn't covered on load.
  const [isSidebarOpen, setIsSidebarOpen] = useState<boolean>(isDesktop)
  const [sidebarTab, setSidebarTab] = useState<TabId>("drawing")

  // The selected tool is kept in BOTH a ref and state, deliberately:
  //   - the ref is what the pointer handlers read on every event, so changing
  //     tools never re-subscribes the drag listeners;
  //   - the state is what lets the Drawing tab render which tool is active.
  // Keeping the pair here, in one place, is what lets the Drawing tab's tool
  // picker stay presentational instead of writing to a ref it was handed.
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

  // Viewer cursor display preferences (hide cursors / hide names), persisted
  // client-side. Read by CursorOverlay and toggled from the Room tab.
  const {
    showCursors,
    showNames: showCursorNames,
    setShowCursors,
    setShowNames: setShowCursorNames,
  } = useCursorPreferences()
  const { recent, addRecent } = useRecentColors()
  const { saved, addSaved, removeSaved } = useSavedColors(user)

  // Room
  const [isRoomOpen, setIsRoomOpen] = useState<boolean>(false)
  const [isMembersOpen, setIsMembersOpen] = useState<boolean>(false)
  const [isDashboardOpen, setIsDashboardOpen] = useState<boolean>(false)
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
    claimOwnership,
    releaseOwnership,
    setOpenEditing,
    resize,
    canvasDims,
    editorRequests,
    requestEditor,
    respondEditor,
    checkpoints,
    createCheckpoint,
    restoreCheckpoint,
    deleteCheckpoint,
    requestPlayback,
    playback,
    clearPlayback,
    canvasResize,
    cursorsRef,
    cursorIds,
  } = useRoomConnection(canvasRef, () => setIsRoomOpen(false), user?.id ?? null)

  // Undo/Redo
  const { pushAction, undo, redo, canUndo, canRedo, notice, reanchorHistory } =
    useUndoRedo(canvasRef, sendDrawInstruction)

  // A resize changes the canvas stride, so every stored undo entry's byte index
  // must be re-anchored (top-left) to the new size — kept where the pixel still
  // exists, dropped where a shrink cut it away. canvasResize carries the old and
  // new dims of the most recent resize.
  useEffect(() => {
    if (canvasResize) {
      reanchorHistory(canvasResize.from, canvasResize.to)
    }
  }, [canvasResize, reanchorHistory])

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

  // Opens the colour picker for the primary or secondary swatch. Used by the
  // Drawing tab's colour controls.
  const openColorPopup = useCallback((primary: boolean) => {
    setSelectedColor(primary ? "primary" : "secondary")
    setIsColorOpen(true)
  }, [])

  // Downloading the current canvas as a PNG. Used by the Room tab's download
  // button (§12.9: shared as soon as a second caller appears).
  const handleDownload = useCallback(() => {
    if (canvasRef.current) {
      downloadCanvasImage(canvasRef.current, roomId)
    }
  }, [roomId])

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

  // Undo/redo keyboard shortcuts. (A central keymap for all shortcuts arrives in
  // the Phase 5 a11y commit; this is the pre-existing Ctrl/Cmd+Z pair.)
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
    <div ref={frameRef} className="app-wrapper">
      <RoomStatus
        roomId={roomId}
        socketLabel={socketLabel}
        onOpenRoomPicker={() => setIsRoomOpen(true)}
      />
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
      <CanvasBoard canvasRef={canvasRef} />
      <CursorOverlay
        canvasRef={canvasRef}
        cursorsRef={cursorsRef}
        cursorIds={cursorIds}
        participants={participants}
        showCursors={showCursors}
        showNames={showCursorNames}
      />
      {notice && <div className="undo-notice">{notice}</div>}
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
      <PlaybackViewer playback={playback} onClose={clearPlayback} />
      <AuthPopup
        isOpen={isAuthOpen}
        onClose={() => setIsAuthOpen(false)}
        onLogin={login}
        onRegister={register}
      />
      {/* Phase 5 sidebar. Drawing and Room are wired; Timeline is still a
          placeholder, filled in by the next commit. */}
      <SideBar
        isOpen={isSidebarOpen}
        onToggle={() => setIsSidebarOpen((open) => !open)}
        activeTab={sidebarTab}
        onTabChange={setSidebarTab}
      >
        {sidebarTab === "drawing" ? (
          <DrawingTab
            selectedTool={selectedTool}
            onSelectTool={selectTool}
            strokeSize={strokeSize}
            onStrokeSizeChange={setStrokeSize}
            colorPalette={colorPalette}
            onSwap={swapColors}
            openColorPopup={openColorPopup}
            onUndo={undo}
            onRedo={redo}
            canUndo={canUndo}
            canRedo={canRedo}
          />
        ) : sidebarTab === "room" ? (
          <RoomTab
            participants={participants}
            self={self}
            openEditing={settings.openEditing}
            hasOwner={settings.hasOwner}
            canvasWidth={canvasDims.width}
            canvasHeight={canvasDims.height}
            onClaimOwnership={claimOwnership}
            onReleaseOwnership={releaseOwnership}
            onSetOpenEditing={setOpenEditing}
            onResize={resize}
            onClear={clearCanvas}
            onDownload={handleDownload}
            editorRequests={editorRequests}
            onRequestEditor={requestEditor}
            onRespondEditor={respondEditor}
            showCursors={showCursors}
            showCursorNames={showCursorNames}
            onShowCursorsChange={setShowCursors}
            onShowCursorNamesChange={setShowCursorNames}
          />
        ) : (
          <TimelineTab
            checkpoints={checkpoints}
            canEdit={hasEditAuthority(self?.role ?? "guest")}
            onCreate={createCheckpoint}
            onRestore={restoreCheckpoint}
            onDelete={deleteCheckpoint}
            onReplay={requestPlayback}
          />
        )}
      </SideBar>
    </div>
  )
}
//#endregion
