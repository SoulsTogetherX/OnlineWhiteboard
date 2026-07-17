//#region Imports
import { useState } from "react"

import PopupBase from "@/components/Popups/PopupBase"

import type { AuthResult } from "@/hooks/useAuth"

import "./styles.css"
//#endregion

//#region Component
type Mode = "login" | "register"

export interface AuthPopupProps {
  isOpen: boolean
  onClose: () => void
  onLogin: (email: string, password: string) => Promise<AuthResult>
  onRegister: (
    email: string,
    username: string,
    password: string,
  ) => Promise<AuthResult>
}

export default function AuthPopup({
  isOpen,
  onClose,
  onLogin,
  onRegister,
}: AuthPopupProps) {
  const [mode, setMode] = useState<Mode>("login")
  const [email, setEmail] = useState<string>("")
  const [username, setUsername] = useState<string>("")
  const [password, setPassword] = useState<string>("")
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState<boolean>(false)

  // Reset the form each time the popup opens — PopupBase never unmounts its
  // children (it only toggles a class), so without this a cancelled attempt's
  // fields and error would still be there next time. Adjusted during render, the
  // same pattern ColorPopup and RoomPopup use.
  const [wasOpen, setWasOpen] = useState<boolean>(isOpen)
  if (isOpen !== wasOpen) {
    setWasOpen(isOpen)
    if (isOpen) {
      setError(null)
      setPassword("")
      setSubmitting(false)
    }
  }

  const switchMode = (next: Mode) => {
    setMode(next)
    setError(null)
  }

  const handleSubmit = async (ev: React.FormEvent) => {
    ev.preventDefault()
    if (submitting) {
      return
    }
    setSubmitting(true)
    setError(null)

    const result =
      mode === "login"
        ? await onLogin(email, password)
        : await onRegister(email, username, password)

    setSubmitting(false)
    if (result.ok) {
      onClose()
    } else {
      setError(result.error)
    }
  }

  const isLogin = mode === "login"

  return (
    <PopupBase
      isOpen={isOpen}
      onClose={onClose}
      label={isLogin ? "Log in" : "Create an account"}
    >
      <form className="auth-popup" onSubmit={handleSubmit}>
        <header className="auth-header">
          <h2>{isLogin ? "Log in" : "Create an account"}</h2>
          <p>
            {isLogin
              ? "Log in to keep your saved colors across devices."
              : "Accounts save your color palette and show your name to others."}
          </p>
        </header>

        <label className="auth-field">
          <span>Email</span>
          <input
            type="email"
            name="email"
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
        </label>

        {!isLogin && (
          <label className="auth-field">
            <span>Display name</span>
            <input
              type="text"
              name="username"
              autoComplete="nickname"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              minLength={2}
              maxLength={32}
              required
            />
          </label>
        )}

        <label className="auth-field">
          <span>Password</span>
          <input
            type="password"
            name="password"
            autoComplete={isLogin ? "current-password" : "new-password"}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            minLength={8}
            required
          />
        </label>

        {error && (
          <p className="auth-error" role="alert">
            {error}
          </p>
        )}

        <button type="submit" className="auth-submit" disabled={submitting}>
          {submitting ? "…" : isLogin ? "Log in" : "Register"}
        </button>

        <p className="auth-switch">
          {isLogin ? "Need an account?" : "Already have an account?"}{" "}
          <button
            type="button"
            onClick={() => switchMode(isLogin ? "register" : "login")}
          >
            {isLogin ? "Register" : "Log in"}
          </button>
        </p>
      </form>
    </PopupBase>
  )
}
//#endregion
