//#region Imports
import { useCallback, useState } from "react"

import Lobby from "@/components/Lobby"
import AuthPopup from "@/components/Popups/AuthPopup"
import Whiteboard from "./Whiteboard"

import useAuth from "@/hooks/useAuth"
import useDisclosure from "@/hooks/useDisclosure"
import useTheme from "@/hooks/useTheme"
import { useSessionStorage } from "@/hooks/useSessionStorage"

import { ROOM_ID_STORAGE_KEY } from "@/hooks/useRoomConnection"

import "./styles.css"
//#endregion

//#region Icons
// Outline-only and drawn in currentColor, matching every other icon in the app.
// The sun/moon emoji this replaces was the one glyph carrying its own palette,
// which made it read as decoration sitting next to the UI rather than part of it.
function SunIcon() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <circle cx="8" cy="8" r="3.1" />
      <path d="M8 1v1.6M8 13.4V15M1 8h1.6M13.4 8H15M3.05 3.05l1.13 1.13M11.82 11.82l1.13 1.13M12.95 3.05l-1.13 1.13M4.18 11.82l-1.13 1.13" />
    </svg>
  )
}

function MoonIcon() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <path d="M13.5 9.7A5.8 5.8 0 0 1 6.3 2.5a5.9 5.9 0 1 0 7.2 7.2" />
    </svg>
  )
}
//#endregion

//#region Page Def
// The shell. It owns only what outlives a room — who you are, the theme, and
// which room (if any) you are in — and picks between the lobby and the board.
//
// The board is a separate component rather than a branch inside this one so that
// its dozen hooks, and its socket, do not run at all while you are in the lobby.
export default function App() {
  const {
    user,
    isLoading: authLoading,
    login,
    register,
    logout,
    updateUsername,
    deleteAccount,
  } = useAuth()
  const authPopup = useDisclosure()
  const { theme, toggle: toggleTheme } = useTheme()

  // The room to offer back in the lobby. Session-scoped like the rest of the
  // per-tab state, so a new tab opens on the lobby with an empty field.
  const [lastRoomId, setLastRoomId] = useSessionStorage<string>(
    ROOM_ID_STORAGE_KEY,
    "",
  )

  // null means "in the lobby". Entering a room mounts the board; leaving unmounts
  // it, which is what closes the socket.
  const [activeRoomId, setActiveRoomId] = useState<string | null>(null)

  const enterRoom = useCallback(
    (roomId: string) => {
      setLastRoomId(roomId)
      setActiveRoomId(roomId)
    },
    [setLastRoomId],
  )

  const leaveRoom = useCallback(() => {
    setActiveRoomId(null)
  }, [])

  return (
    <>
      {/* Top-left in both views, so the theme is reachable before you have
          picked a room as well as inside one. */}
      <button
        type="button"
        className="theme-toggle"
        onClick={toggleTheme}
        aria-label={
          theme === "dark" ? "Switch to light mode" : "Switch to dark mode"
        }
        title={theme === "dark" ? "Light mode" : "Dark mode"}
      >
        {theme === "dark" ? <SunIcon /> : <MoonIcon />}
      </button>

      {activeRoomId === null ? (
        <Lobby
          user={user}
          isLoading={authLoading}
          onOpenAuth={authPopup.open}
          onLogout={logout}
          onEnterRoom={enterRoom}
          lastRoomId={lastRoomId}
        />
      ) : (
        <Whiteboard
          user={user}
          initialRoomId={activeRoomId}
          onRoomChange={setLastRoomId}
          onLeaveRoom={leaveRoom}
          onOpenAuth={authPopup.open}
          onLogout={logout}
          onUpdateUsername={updateUsername}
          onDeleteAccount={deleteAccount}
        />
      )}

      {/* Shared by both views, so signing in from the lobby and from the foot of
          the Room tab go through exactly the same form. */}
      <AuthPopup
        isOpen={authPopup.isOpen}
        onClose={authPopup.close}
        onLogin={login}
        onRegister={register}
      />
    </>
  )
}
//#endregion
