//#region Imports
import { useState } from "react"

import useMyRooms from "@/hooks/useMyRooms"
import PopupBase from "@/components/Popups/PopupBase"
import { relativeTime } from "@/utils/relativeTime"
import RoomThumbnail from "./RoomThumbnail"

import "./styles.css"
//#endregion

//#region Icons
function TrashIcon() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <path d="M5.5 5.5A.5.5 0 0 1 6 6v6a.5.5 0 0 1-1 0V6a.5.5 0 0 1 .5-.5m2.5 0a.5.5 0 0 1 .5.5v6a.5.5 0 0 1-1 0V6a.5.5 0 0 1 .5-.5m3 .5a.5.5 0 0 0-1 0v6a.5.5 0 0 0 1 0z" />
      <path d="M14.5 3a1 1 0 0 1-1 1H13v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V4h-.5a1 1 0 0 1-1-1V2a1 1 0 0 1 1-1H6a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1h3.5a1 1 0 0 1 1 1zM4.118 4 4 4.059V13a1 1 0 0 0 1 1h6a1 1 0 0 0 1-1V4.059L11.882 4zM2.5 3h11V2h-11z" />
    </svg>
  )
}
//#endregion

//#region Component
export interface DashboardProps {
  isOpen: boolean
  currentRoomId: string
  onClose: () => void
  onOpenRoom: (roomId: string) => void
}

// A modal listing the rooms the logged-in user belongs to, each as a card with a
// live thumbnail, role, and when it was last active. Clicking a card loads that
// room; ticking cards and pressing the bin removes them from the list.
//
// "Removes from the list" is exact: it deletes YOUR membership (releasing
// ownership if you held it) and leaves the canvas completely alone. That is why
// nothing the user can see calls it Delete — the pixels, the history and
// everyone else's access all survive, and the board is only ever reclaimed by
// the server's stale-room sweep.
//
// Routed through PopupBase so the dialog role, aria-modal, Escape-to-close and
// inert are handled once (§12.9).
export default function Dashboard({
  isOpen,
  currentRoomId,
  onClose,
  onOpenRoom,
}: DashboardProps) {
  const { rooms, error, leaveRooms } = useMyRooms(isOpen)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [busy, setBusy] = useState(false)

  // Every visit starts with nothing ticked. A selection surviving a close would
  // be a destructive action left armed by a previous session, one click away.
  //
  // Adjusted DURING RENDER rather than in an effect — the same pattern the Room
  // tab uses to re-seed its change-room field. React re-runs this component
  // immediately with the corrected state, before anything paints, so there is no
  // flash of the stale selection and no second commit; an effect would set state
  // after the render that already showed the old value.
  const [wasOpen, setWasOpen] = useState(isOpen)
  if (isOpen !== wasOpen) {
    setWasOpen(isOpen)
    if (selected.size > 0) {
      setSelected(new Set())
    }
  }

  // Rooms can vanish from under a selection (removed here, or gone on a
  // refetch), and a stale id would keep the bin enabled with nothing to act on.
  // Intersecting with what is actually listed keeps the count honest.
  const live = new Set(rooms.map((room) => room.roomId))
  const chosen = [...selected].filter((roomId) => live.has(roomId))
  const count = chosen.length

  const toggle = (roomId: string) => {
    setSelected((previous) => {
      const next = new Set(previous)
      // delete() reports whether it removed anything, so this is one lookup
      // rather than a has() followed by the opposite operation.
      if (!next.delete(roomId)) {
        next.add(roomId)
      }
      return next
    })
  }

  const removeChosen = async () => {
    if (count === 0 || busy) {
      return
    }
    setBusy(true)
    await leaveRooms(chosen)
    setSelected(new Set())
    setBusy(false)
  }

  const binLabel =
    count === 0
      ? "Select rooms to remove them from this list"
      : `Remove ${count} room${count === 1 ? "" : "s"} from your list (the canvas is kept)`

  return (
    <PopupBase isOpen={isOpen} onClose={onClose} label="My rooms">
      {/* Gated on isOpen: each RoomThumbnail fetches a snapshot on mount, so the
          cards should exist only while the dashboard is open (and refetch on a
          reopen) — PopupBase keeps its children mounted otherwise. */}
      {isOpen && (
        <div className="dashboard-panel">
          {/* Sticky, so the title and both actions stay put while a long list
              scrolls under them. The bin is useless if ticking a card near the
              bottom means scrolling back up to reach it. */}
          <header className="dashboard-header">
            <h1 className="dashboard-title">My Rooms</h1>
            <div className="dashboard-actions">
              <span className="dashboard-selection" aria-live="polite">
                {count > 0 && `${count} selected`}
              </span>
              {/* The tooltip sits on a wrapper, not on the button. A disabled
                  button fires no pointer events in most browsers, so a title on
                  it would hide the one explanation you need precisely when it is
                  greyed out. */}
              <span className="dashboard-bin-wrap" title={binLabel}>
                <button
                  type="button"
                  className="dashboard-bin"
                  onClick={removeChosen}
                  disabled={count === 0 || busy}
                  aria-label={binLabel}
                >
                  <TrashIcon />
                </button>
              </span>
              <button
                type="button"
                className="dashboard-close"
                onClick={onClose}
              >
                Close
              </button>
            </div>
          </header>

          {error && <p className="dashboard-error">{error}</p>}

          {!error && rooms.length === 0 && (
            <p className="dashboard-empty">
              You aren&apos;t a member of any rooms yet. Draw in a room while
              logged in and it&apos;ll show up here.
            </p>
          )}

          <ul className="dashboard-grid">
            {rooms.map((room) => {
              const name = room.title || room.roomId
              const isSelected = selected.has(room.roomId)
              return (
                <li
                  key={room.roomId}
                  className={`dashboard-item${
                    isSelected ? " dashboard-item-selected" : ""
                  }`}
                >
                  {/* A SIBLING of the card, not a child of it: a checkbox inside
                      a button is nested interactive content, which browsers and
                      screen readers both handle badly. */}
                  <input
                    type="checkbox"
                    className="dashboard-select"
                    checked={isSelected}
                    onChange={() => toggle(room.roomId)}
                    aria-label={`Select ${name}`}
                  />
                  <button
                    type="button"
                    className={`dashboard-card${
                      room.roomId === currentRoomId
                        ? " dashboard-card-current"
                        : ""
                    }`}
                    onClick={() => onOpenRoom(room.roomId)}
                  >
                    <RoomThumbnail roomId={room.roomId} />
                    <span className="dashboard-card-body">
                      <span className="dashboard-card-name">{name}</span>
                      <span className="dashboard-card-meta">
                        <span className={`dashboard-role role-${room.role}`}>
                          {room.role}
                        </span>
                        <span className="dashboard-when">
                          {relativeTime(room.updatedAt)}
                        </span>
                      </span>
                    </span>
                  </button>
                </li>
              )
            })}
          </ul>
        </div>
      )}
    </PopupBase>
  )
}
//#endregion
