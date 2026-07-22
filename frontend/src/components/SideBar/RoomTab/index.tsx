//#region Imports
import { useState } from "react"

import IconButton from "@/components/IconButton"
import Toggle from "@/components/Toggle"

import MemberList from "./MemberList"
import OwnershipButton from "./OwnershipButton"
import CursorControls from "./CursorControls"
import ResizeControl from "./ResizeControl"
import EditorRequests from "./EditorRequests"
import RoomHistory from "./RoomHistory"

import {
  canManageRoom,
  canRequestEditor,
} from "@shared/types/identity"
import type { Participant } from "@shared/types/identity"
import type {
  CheckpointInfo,
  EditorRequest,
} from "@shared/types/socketProtocol"

import "./styles.css"
//#endregion

//#region Icons
// Decorative — IconButton's label carries the accessible name.
function ClearIcon() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <path d="M5.5 5.5A.5.5 0 0 1 6 6v6a.5.5 0 0 1-1 0V6a.5.5 0 0 1 .5-.5m2.5 0a.5.5 0 0 1 .5.5v6a.5.5 0 0 1-1 0V6a.5.5 0 0 1 .5-.5m3 .5a.5.5 0 0 0-1 0v6a.5.5 0 0 0 1 0z" />
      <path d="M14.5 3a1 1 0 0 1-1 1H13v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V4h-.5a1 1 0 0 1-1-1V2a1 1 0 0 1 1-1H6a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1h3.5a1 1 0 0 1 1 1zM4.118 4 4 4.059V13a1 1 0 0 0 1 1h6a1 1 0 0 0 1-1V4.059L11.882 4zM2.5 3h11V2h-11z" />
    </svg>
  )
}

function DownloadIcon() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <path d="M.5 9.9a.5.5 0 0 1 .5.5v2.5a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-2.5a.5.5 0 0 1 1 0v2.5a2 2 0 0 1-2 2H2a2 2 0 0 1-2-2v-2.5a.5.5 0 0 1 .5-.5" />
      <path d="M7.646 11.854a.5.5 0 0 0 .708 0l3-3a.5.5 0 0 0-.708-.708L8.5 10.293V1.5a.5.5 0 0 0-1 0v8.793L5.354 8.146a.5.5 0 1 0-.708.708z" />
    </svg>
  )
}
//#endregion

//#region Component Def
export interface RoomTabProps {
  // The room's id + live connection status, shown here now instead of a floating
  // top bar; the change-room field lives here too (was a separate popup).
  roomId: string
  socketLabel: string
  onLoadRoom: (roomId: string) => void
  // Back to the lobby. Account controls live in the Account tab; this tab is
  // only about the room you are in.
  onLeaveRoom: () => void
  participants: Participant[]
  self: Participant | null
  openEditing: boolean
  hasOwner: boolean
  canvasWidth: number
  canvasHeight: number
  onClaimOwnership: () => void
  onReleaseOwnership: () => void
  onSetOpenEditing: (enabled: boolean) => void
  onResize: (width: number, height: number) => void
  onClear: () => void
  onDownload: () => void
  editorRequests: EditorRequest[]
  onRequestEditor: () => void
  onRespondEditor: (userId: string, approve: boolean) => void
  // The room's history. It used to be a sidebar tab of its own; a room's
  // timeline belongs to the room, so it lives here with everything else about
  // this board.
  checkpoints: CheckpointInfo[]
  canEditHistory: boolean
  onCreateCheckpoint: (name: string) => void
  onRestoreCheckpoint: (checkpointId: string) => void
  onDeleteCheckpoint: (checkpointId: string) => void
  onReplay: (fromCheckpointId?: string) => void
  // Viewer cursor display preferences (useCursorPreferences).
  showCursors: boolean
  showCursorNames: boolean
  onShowCursorsChange: (value: boolean) => void
  onShowCursorNamesChange: (value: boolean) => void
}

// The Room tab: a thin composition of small controls, each fed data + callbacks.
// It reads permissions through the SAME shared predicates the server enforces
// with (canManageRoom / canRequestEditor), so every greyed control matches what
// the server would actually allow — never the two disagreeing (§12.9).
export default function RoomTab({
  roomId,
  socketLabel,
  onLoadRoom,
  onLeaveRoom,
  participants,
  self,
  openEditing,
  hasOwner,
  canvasWidth,
  canvasHeight,
  onClaimOwnership,
  onReleaseOwnership,
  onSetOpenEditing,
  onResize,
  onClear,
  onDownload,
  editorRequests,
  onRequestEditor,
  onRespondEditor,
  checkpoints,
  canEditHistory,
  onCreateCheckpoint,
  onRestoreCheckpoint,
  onDeleteCheckpoint,
  onReplay,
  showCursors,
  showCursorNames,
  onShowCursorsChange,
  onShowCursorNamesChange,
}: RoomTabProps) {
  const role = self?.role ?? "guest"
  const isOwner = canManageRoom(role)
  const isGuest = self?.isGuest ?? true
  const mayRequestEditor = canRequestEditor(role)

  // The change-room field, re-seeded to the live room whenever it changes (the
  // during-render reset pattern, as RoomPopup used) so it always defaults to the
  // current room and discards a half-typed draft after a switch.
  const [draftRoomId, setDraftRoomId] = useState(roomId)
  const [seenRoomId, setSeenRoomId] = useState(roomId)
  if (roomId !== seenRoomId) {
    setSeenRoomId(roomId)
    setDraftRoomId(roomId)
  }

  return (
    <div className="room-tab">
      <section className="room-header" aria-label="Room">
        <div className="room-header-line">
          <span className="room-header-id">Room: {roomId}</span>
          <span className="room-header-conn" aria-live="polite">
            {socketLabel}
          </span>
        </div>
      </section>

      <MemberList
        participants={participants}
        selfConnectionId={self?.connectionId ?? null}
      />

      <OwnershipButton
        isOwner={isOwner}
        hasOwner={hasOwner}
        isGuest={isGuest}
        onClaim={onClaimOwnership}
        onRelease={onReleaseOwnership}
      />

      <Toggle
        checked={openEditing}
        disabled={!isOwner}
        onChange={onSetOpenEditing}
        label="Let guests &amp; viewers draw"
      />

      {mayRequestEditor && (
        <button
          type="button"
          className="room-request-editor"
          onClick={onRequestEditor}
        >
          Request editor access
        </button>
      )}

      {isOwner && (
        <EditorRequests
          requests={editorRequests}
          onRespond={onRespondEditor}
        />
      )}

      <CursorControls
        showCursors={showCursors}
        showNames={showCursorNames}
        onShowCursorsChange={onShowCursorsChange}
        onShowNamesChange={onShowCursorNamesChange}
      />

      <ResizeControl
        width={canvasWidth}
        height={canvasHeight}
        disabled={!isOwner}
        onResize={onResize}
      />

      <form
        className="room-change"
        onSubmit={(event) => {
          event.preventDefault()
          const next = draftRoomId.trim()
          if (next.length > 0) {
            onLoadRoom(next)
          }
        }}
      >
        <label className="room-change-label" htmlFor="room-change-input">
          Change room
        </label>
        <div className="room-change-row">
          <input
            id="room-change-input"
            type="text"
            value={draftRoomId}
            onChange={(event) => setDraftRoomId(event.target.value)}
            maxLength={22}
            autoComplete="off"
          />
          <button type="submit">Go</button>
        </div>
      </form>

      <button type="button" className="room-leave" onClick={onLeaveRoom}>
        Leave room
      </button>

      {/* The room's history, folded in from what used to be its own tab. */}
      <RoomHistory
        checkpoints={checkpoints}
        canEdit={canEditHistory}
        onCreate={onCreateCheckpoint}
        onRestore={onRestoreCheckpoint}
        onDelete={onDeleteCheckpoint}
        onReplay={onReplay}
      />

      {/* Clear and download sit at the very bottom: one is destructive and the
          other ends a session, so neither belongs next to the controls used
          while drawing. */}
      <div className="room-tab-footer">
        <IconButton
          label="Clear canvas"
          onClick={onClear}
          disabled={!isOwner}
          className="room-clear"
        >
          <ClearIcon />
        </IconButton>
        {/* Available to everyone — a download is a read of the local canvas. */}
        <IconButton label="Download image" onClick={onDownload}>
          <DownloadIcon />
        </IconButton>
      </div>
    </div>
  )
}
//#endregion
