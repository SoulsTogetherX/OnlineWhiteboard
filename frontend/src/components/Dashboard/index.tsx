//#region Imports
import useMyRooms from "@/hooks/useMyRooms"
import PopupBase from "@/components/Popups/PopupBase"
import { relativeTime } from "@/utils/relativeTime"
import RoomThumbnail from "./RoomThumbnail"

import "./styles.css"
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
// room. Routed through PopupBase so the dialog role, aria-modal, Escape-to-close
// and inert are handled once (§12.9) — it used to hand-roll its own Escape and
// role="dialog".
export default function Dashboard({
  isOpen,
  currentRoomId,
  onClose,
  onOpenRoom,
}: DashboardProps) {
  const { rooms, error } = useMyRooms(isOpen)

  return (
    <PopupBase isOpen={isOpen} onClose={onClose} label="My rooms">
      {/* Gated on isOpen: each RoomThumbnail fetches a snapshot on mount, so the
          cards should exist only while the dashboard is open (and refetch on a
          reopen) — PopupBase keeps its children mounted otherwise. */}
      {isOpen && (
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
              You aren&apos;t a member of any rooms yet. Draw in a room while
              logged in and it&apos;ll show up here.
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
      )}
    </PopupBase>
  )
}
//#endregion
