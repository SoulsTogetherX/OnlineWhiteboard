//#region Imports
import { useEffect } from "react"

import useMyRooms from "@/hooks/useMyRooms"
import RoomThumbnail from "./RoomThumbnail"

import "./styles.css"
//#endregion

//#region Helpers
// "3 days ago" style relative time from an ISO timestamp.
function relativeTime(iso: string): string {
  const then = new Date(iso).getTime()
  if (Number.isNaN(then)) {
    return ""
  }
  const seconds = Math.max(0, Math.round((Date.now() - then) / 1000))
  const units: [number, string][] = [
    [60, "second"],
    [60, "minute"],
    [24, "hour"],
    [7, "day"],
    [4.35, "week"],
    [12, "month"],
    [Number.POSITIVE_INFINITY, "year"],
  ]
  let value = seconds
  for (const [size, name] of units) {
    if (value < size) {
      const rounded = Math.round(value)
      return `${rounded} ${name}${rounded === 1 ? "" : "s"} ago`
    }
    value /= size
  }
  return ""
}
//#endregion

//#region Component
export interface DashboardProps {
  isOpen: boolean
  currentRoomId: string
  onClose: () => void
  onOpenRoom: (roomId: string) => void
}

// A full-screen overlay listing the rooms the logged-in user belongs to, each as
// a card with a live thumbnail, role, and when it was last active. Clicking a
// card loads that room. Not a router (the app has none yet) — a modal keeps this
// self-contained until the planned UI redo.
export default function Dashboard({
  isOpen,
  currentRoomId,
  onClose,
  onOpenRoom,
}: DashboardProps) {
  const { rooms, error } = useMyRooms(isOpen)

  // Escape closes it, like the other popups.
  useEffect(() => {
    if (!isOpen) {
      return
    }
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === "Escape") {
        onClose()
      }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [isOpen, onClose])

  if (!isOpen) {
    return null
  }

  return (
    <div className="dashboard-overlay" role="dialog" aria-label="My rooms">
      <div className="dashboard-panel">
        <header className="dashboard-header">
          <h1 className="dashboard-title">My Rooms</h1>
          <button type="button" className="dashboard-close" onClick={onClose}>
            Close
          </button>
        </header>

        {error && <p className="dashboard-error">{error}</p>}

        {!error && rooms.length === 0 && (
          <p className="dashboard-empty">
            You aren&apos;t a member of any rooms yet. Draw in a room while logged
            in and it&apos;ll show up here.
          </p>
        )}

        <ul className="dashboard-grid">
          {rooms.map((room) => (
            <li key={room.roomId}>
              <button
                type="button"
                className={`dashboard-card${
                  room.roomId === currentRoomId ? " dashboard-card-current" : ""
                }`}
                onClick={() => onOpenRoom(room.roomId)}
              >
                <RoomThumbnail roomId={room.roomId} />
                <span className="dashboard-card-body">
                  <span className="dashboard-card-name">
                    {room.title || room.roomId}
                  </span>
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
          ))}
        </ul>
      </div>
    </div>
  )
}
//#endregion
