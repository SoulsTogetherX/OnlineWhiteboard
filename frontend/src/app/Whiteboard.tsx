//#region Imports
import { useCallback, useEffect, useRef } from "react"

import Button from "@/components/Button"
import CanvasBoard from "@/components/CanvasBoard"
import CursorOverlay from "@/components/CursorOverlay"
import MembersPopup from "@/components/Popups/MembersPopup"
import ColorPopup from "@/components/Popups/ColorPopup"
import Dashboard from "@/components/Dashboard"
import PlaybackViewer from "@/components/PlaybackViewer"
import SideBar from "@/components/SideBar"
import RoomTab from "@/components/SideBar/RoomTab"
import DrawingTab from "@/components/SideBar/DrawingTab"
import AccountTab from "@/components/SideBar/AccountTab"

import useCanvasMotion from "@/hooks/dragHooks/useCanvasMotion"
import useCanvasDrawing from "@/hooks/dragHooks/useCanvasDrawing"
import useRoomConnection from "@/hooks/useRoomConnection"
import useColorPalette from "@/hooks/useColorPalette"
import useUndoRedo from "@/hooks/useUndoRedo"
import useCursorBroadcast from "@/hooks/useCursorBroadcast"
import useCursorPreferences from "@/hooks/useCursorPreferences"
import useRecentColors from "@/hooks/useRecentColors"
import useSavedColors from "@/hooks/useSavedColors"
import useEyedropper from "@/hooks/useEyedropper"
import useDrawingTools from "@/hooks/useDrawingTools"
import useSidebar from "@/hooks/useSidebar"
import useColorPopup from "@/hooks/useColorPopup"
import useDisclosure from "@/hooks/useDisclosure"
import useKeymap from "@/hooks/useKeymap"
import useShiftHeld from "@/hooks/useModifierHeld"
import useBrushPreview from "@/hooks/useBrushPreview"

import { colorToHex8 } from "@/utils/color"
import { downloadCanvasImage } from "@/utils/downloadImage"
import { toolCursorCss } from "@/utils/toolCursor"

import type { ExportFormat } from "@/utils/downloadImage"

import { canDraw, hasEditAuthority } from "@shared/types/identity"

import type { AppTool } from "@/components/SideBar/DrawingTab/tools"
import type { AuthUser } from "@shared/types/identity"
import type { ColorType } from "@shared/types/primitive"
//#endregion

//#region Component Def
export interface WhiteboardProps {
  user: AuthUser | null
  // The room to open. This component only ever mounts once the shell knows which
  // room is being entered, which is what keeps the socket closed in the lobby.
  initialRoomId: string
  // Reports the live room upward so the shell can offer it back in the lobby
  // after switching rooms from the Room tab.
  onRoomChange: (roomId: string) => void
  onLeaveRoom: () => void
  onOpenAuth: () => void
  onLogout: () => void
  onUpdateUsername: (username: string) => Promise<{ ok: boolean; error?: string }>
  onDeleteAccount: () => Promise<{ ok: boolean; error?: string }>
}

// Everything that only exists inside a room: the canvas, the tools, the sidebar
// and the live connection. Split out of App so the shell above it can render the
// lobby instead, without this file's dozen hooks running for a board that is not
// on screen.
export default function Whiteboard({
  user,
  initialRoomId,
  onRoomChange,
  onLeaveRoom,
  onOpenAuth,
  onLogout,
  onUpdateUsername,
  onDeleteAccount,
}: WhiteboardProps) {
  // Canvas plumbing — the frame that pans/zooms and the canvas element itself.
  const frameRef = useRef<HTMLDivElement>(
    null,
  ) as React.RefObject<HTMLDivElement>
  const canvasRef = useRef<HTMLCanvasElement>(
    null,
  ) as React.RefObject<HTMLCanvasElement>
  // The brush-footprint overlay that sits exactly on top of the canvas.
  const previewRef = useRef<HTMLCanvasElement>(
    null,
  ) as React.RefObject<HTMLCanvasElement>

  // Drawing tools: the tool / stroke / eyedropper ref+state cluster (§13.5). The
  // refs are read by the pointer handlers on every event; the parallel state is
  // what the Drawing tab renders.
  const {
    drawAction,
    selectedTool,
    selectTool,
    eyedropperActive,
    revertToLastDrawTool,
    strokeSizeRef,
    strokeSize,
    setStrokeSize,
    sprayDensityRef,
    sprayDensity,
    setSprayDensity,
    stabilizationRef,
    stabilization,
    setStabilization,
    blurSettingsRef,
    blurBlend,
    setBlurBlend,
    blurOpacity,
    setBlurOpacity,
    lockAlpha,
    setLockAlpha,
    grabbingRef,
  } = useDrawingTools()

  // The right sidebar (Phase 5) is the only tool surface now — the old floating
  // toolbar is gone. It starts open on desktop and collapsed on a phone.
  const sidebar = useSidebar()

  // View-only lock, read by the pointer handlers. A viewer's drawing is blocked
  // client-side (the server enforces it too) so strokes don't flash and revert.
  const viewOnlyRef = useRef<boolean>(false)

  // Color
  const colorPopup = useColorPopup()
  const { colorPalette, setColor, swapColors } = useColorPalette()
  const { recent, addRecent } = useRecentColors()
  const { saved, addSaved, removeSaved } = useSavedColors(user)

  // Viewer cursor display preferences (hide cursors / hide names), persisted
  // client-side. Read by CursorOverlay and toggled from the Room tab.
  const {
    showCursors,
    showNames: showCursorNames,
    setShowCursors,
    setShowNames: setShowCursorNames,
  } = useCursorPreferences()

  // Room — the floating popups this view still owns, plus the live connection.
  // The change-room field lives in the Room tab (no picker popup), so nothing
  // needs closing when a room loads.
  const members = useDisclosure()
  const dashboard = useDisclosure()
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
    cursorTools,
  } = useRoomConnection(canvasRef, () => {}, user?.id ?? null, initialRoomId)

  // Keep the shell's "last room" in step with in-room switches, so leaving and
  // returning to the lobby offers the room actually last used.
  useEffect(() => {
    onRoomChange(roomId)
  }, [roomId, onRoomChange])

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
  // last drawing tool. The bridge between the drawing-tools and colour clusters,
  // so it lives here in the composition root.
  const onEyedropperPick = useCallback(
    (color: ColorType) => {
      setColor("primary", color)
      addRecent(colorToHex8(color))
      revertToLastDrawTool()
    },
    [setColor, addRecent, revertToLastDrawTool],
  )

  // Downloading the current canvas as a PNG. Used by the Room tab's download
  // button (§12.9: shared as soon as a second caller appears).
  const handleDownload = useCallback(
    (format: ExportFormat) => {
      if (canvasRef.current) {
        void downloadCanvasImage(canvasRef.current, roomId, format)
      }
    },
    [roomId],
  )

  // The live tool, as a ref. Read at event time by the cursor broadcaster (which
  // must not resubscribe its pointer listeners every time a tool changes) and by
  // the brush preview (§13.5).
  const selectedToolRef = useRef<AppTool>(selectedTool)
  useEffect(() => {
    selectedToolRef.current = selectedTool
  }, [selectedTool])

  // Shift is the navigate modifier: while it is held, dragging pans and the
  // wheel zooms, and the pointer does not draw. The board never moves without
  // it, so the indicator below is the only cue that the mode exists.
  const navigating = useShiftHeld()

  // Canvas Setup
  useCanvasMotion(frameRef, canvasRef, grabbingRef)
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
    sprayDensityRef,
    blurSettingsRef,
    viewOnlyRef,
    stabilizationRef,
  )
  // The dotted outline of what the current tool would change. Fed the same refs
  // the pointer handlers read, so it always describes the live tool and size.
  useBrushPreview(canvasRef, previewRef, selectedToolRef, strokeSizeRef, viewOnlyRef)
  useEyedropper(canvasRef, eyedropperActive, onEyedropperPick)
  // The tool rides along with every cursor update, so other people see what this
  // pointer is holding. A ref, read at send time: the tool changes often and the
  // broadcaster must not resubscribe its pointer listeners each time.
  useCursorBroadcast(canvasRef, sendCursor, selectedToolRef)

  // The app's keyboard map: undo/redo (Ctrl/Cmd+Z, Ctrl/Cmd+Shift+Z) always, and
  // the single-key tool shortcuts (P/E/F/S/I) while the sidebar is open.
  useKeymap({
    sidebarOpen: sidebar.isOpen,
    onSelectTool: selectTool,
    onUndo: undo,
    onRedo: redo,
  })

  // Frontend
  return (
    <div ref={frameRef} className="app-wrapper">
      {/* Top-right cluster: the logged-in user's room actions. The account
          control that used to sit here is gone — signing in and out now happens
          in the lobby and at the foot of the Room tab. */}
      {user && (
        <div className="app-actions">
          <Button size="sm" onClick={dashboard.open}>
            My Rooms
          </Button>
          <Button size="sm" onClick={members.open}>
            Members
          </Button>
        </div>
      )}
      {/* The local pointer wears the same glyph everyone else sees on it. */}
      <CanvasBoard
        canvasRef={canvasRef}
        dims={canvasDims}
        cursor={toolCursorCss(selectedTool)}
        previewRef={previewRef}
      />
      {/* Shown only while Shift is down: the board is in navigate mode, where
          dragging pans and the wheel zooms. Announced politely rather than
          assertively — it is a mode cue, not an alert. */}
      {navigating && (
        <div className="navigate-hint" role="status" aria-live="polite">
          <svg viewBox="0 0 16 16" aria-hidden="true">
            <path d="M8 1 5.8 3.2h1.45v3.05H4.2V4.8L2 7l2.2 2.2V7.75h3.05v3.05H5.8L8 13l2.2-2.2H8.75V7.75h3.05V9.2L14 7l-2.2-2.2v1.45H8.75V3.2h1.45z" />
          </svg>
          <span>Pan &amp; zoom</span>
        </div>
      )}
      <CursorOverlay
        canvasRef={canvasRef}
        cursorsRef={cursorsRef}
        cursorIds={cursorIds}
        participants={participants}
        cursorTools={cursorTools}
        showCursors={showCursors}
        showNames={showCursorNames}
      />
      {notice && <div className="undo-notice">{notice}</div>}
      <ColorPopup
        isOpen={colorPopup.isOpen}
        onClose={colorPopup.close}
        currentColor={colorPalette.current[colorPopup.target]}
        onApply={(color) => {
          setColor(colorPopup.target, color)
          addRecent(colorToHex8(color))
          colorPopup.close()
        }}
        recent={recent}
        saved={saved}
        onSaveColor={addSaved}
        onRemoveSavedColor={removeSaved}
      />
      <MembersPopup
        isOpen={members.isOpen}
        roomId={roomId}
        onClose={members.close}
      />
      <Dashboard
        isOpen={dashboard.isOpen}
        currentRoomId={roomId}
        onClose={dashboard.close}
        onOpenRoom={(nextRoomId) => {
          loadRoom(nextRoomId)
          dashboard.close()
        }}
      />
      <PlaybackViewer
        playback={playback}
        checkpoints={checkpoints}
        onClose={clearPlayback}
      />
      {/* Phase 5 sidebar. All three tabs — Drawing, Room, Timeline — are wired. */}
      <SideBar
        isOpen={sidebar.isOpen}
        onToggle={sidebar.toggle}
        activeTab={sidebar.activeTab}
        onTabChange={sidebar.setActiveTab}
      >
        {sidebar.activeTab === "drawing" ? (
          <DrawingTab
            selectedTool={selectedTool}
            onSelectTool={selectTool}
            strokeSize={strokeSize}
            onStrokeSizeChange={setStrokeSize}
            sprayDensity={sprayDensity}
            onSprayDensityChange={setSprayDensity}
            blurBlend={blurBlend}
            onBlurBlendChange={setBlurBlend}
            blurOpacity={blurOpacity}
            onBlurOpacityChange={setBlurOpacity}
            lockAlpha={lockAlpha}
            onLockAlphaChange={setLockAlpha}
            stabilization={stabilization}
            onStabilizationChange={setStabilization}
            colorPalette={colorPalette}
            onSwap={swapColors}
            openColorPopup={colorPopup.open}
            onUndo={undo}
            onRedo={redo}
            canUndo={canUndo}
            canRedo={canRedo}
          />
        ) : sidebar.activeTab === "room" ? (
          <RoomTab
            roomId={roomId}
            socketLabel={socketLabel}
            onLoadRoom={loadRoom}
            onLeaveRoom={onLeaveRoom}
            onOpenDashboard={dashboard.open}
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
            checkpoints={checkpoints}
            canEditHistory={hasEditAuthority(self?.role ?? "guest")}
            onCreateCheckpoint={createCheckpoint}
            onRestoreCheckpoint={restoreCheckpoint}
            onDeleteCheckpoint={deleteCheckpoint}
            onReplay={requestPlayback}
            showCursors={showCursors}
            showCursorNames={showCursorNames}
            onShowCursorsChange={setShowCursors}
            onShowCursorNamesChange={setShowCursorNames}
          />
        ) : (
          <AccountTab
            user={user}
            onOpenAuth={onOpenAuth}
            onLogout={onLogout}
            onUpdateUsername={onUpdateUsername}
            onDeleteAccount={onDeleteAccount}
          />
        )}
      </SideBar>
    </div>
  )
}
//#endregion
