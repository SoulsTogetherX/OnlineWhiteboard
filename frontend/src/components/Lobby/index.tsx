//#region Imports
import { useState } from "react"

import type { AuthUser } from "@shared/types/identity"

import "./styles.css"
//#endregion

//#region Component Def
export interface LobbyProps {
  user: AuthUser | null
  isLoading: boolean
  // Opens the shared auth popup — the lobby does not own the login form, so
  // signing in from here and from inside a room go through the same code.
  onOpenAuth: () => void
  onLogout: () => void
  onEnterRoom: (roomId: string) => void
  // The room this browser was last in, offered back as the default so returning
  // is one click rather than remembering an id.
  lastRoomId: string
}

// The screen the app opens on: no canvas, no tools, just "who am I" and "which
// room". The board and its whole sidebar only mount once a room is entered,
// which is also what keeps the socket closed until there is a room to join.
export default function Lobby({
  user,
  isLoading,
  onOpenAuth,
  onLogout,
  onEnterRoom,
  lastRoomId,
}: LobbyProps) {
  const [roomId, setRoomId] = useState(lastRoomId)
  const trimmed = roomId.trim()

  return (
    <main className="lobby">
      <div className="lobby-card">
        <h1 className="lobby-title">Group Whiteboard</h1>

        <section className="lobby-account" aria-label="Account">
          {isLoading ? (
            // Nothing rather than a flash of "Log in" before /api/auth/me lands.
            <span className="lobby-account-placeholder" aria-hidden="true" />
          ) : user ? (
            <>
              <span className="lobby-identity">
                <span
                  className="lobby-color-dot"
                  style={{ backgroundColor: user.color }}
                  aria-hidden="true"
                />
                <span className="lobby-username">{user.username}</span>
              </span>
              <button
                type="button"
                className="lobby-button lobby-button-quiet"
                onClick={onLogout}
              >
                Log out
              </button>
            </>
          ) : (
            <>
              <span className="lobby-guest">You are browsing as a guest.</span>
              <button
                type="button"
                className="lobby-button lobby-button-quiet"
                onClick={onOpenAuth}
              >
                Log in or register
              </button>
            </>
          )}
        </section>

        <form
          className="lobby-room"
          onSubmit={(event) => {
            event.preventDefault()
            if (trimmed.length > 0) {
              onEnterRoom(trimmed)
            }
          }}
        >
          <label className="lobby-label" htmlFor="lobby-room-input">
            Room name
          </label>
          <input
            id="lobby-room-input"
            className="lobby-input"
            type="text"
            value={roomId}
            onChange={(event) => setRoomId(event.target.value)}
            maxLength={22}
            autoComplete="off"
            placeholder="e.g. design-review"
          />
          <button
            type="submit"
            className="lobby-button lobby-button-primary"
            disabled={trimmed.length === 0}
          >
            Enter room
          </button>
        </form>
      </div>
    </main>
  )
}
//#endregion
