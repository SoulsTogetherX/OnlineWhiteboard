//#region Imports
import { useState } from "react"

import PopupBase from "@/components/Popups/PopupBase"

import type { AuthResult } from "@/hooks/useAuth"

import "./styles.css"
//#endregion

//#region Component
// "forgot" is the request-a-reset-link step (email only). The set-a-new-password
// step is a separate popup reached from the emailed link (see ResetPasswordPopup),
// not a mode here, because you arrive at it out of band rather than from this form.
type Mode = "login" | "register" | "forgot"

export interface AuthPopupProps {
  isOpen: boolean
  onClose: () => void
  onLogin: (email: string, password: string) => Promise<AuthResult>
  onRegister: (
    email: string,
    username: string,
    password: string,
  ) => Promise<AuthResult>
  onRequestReset: (email: string) => Promise<AuthResult>
}

export default function AuthPopup({
  isOpen,
  onClose,
  onLogin,
  onRegister,
  onRequestReset,
}: AuthPopupProps) {
  const [mode, setMode] = useState<Mode>("login")
  const [email, setEmail] = useState<string>("")
  const [username, setUsername] = useState<string>("")
  const [password, setPassword] = useState<string>("")
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState<boolean>(false)
  // Set once a reset link has been requested, so the forgot view swaps its form
  // for a confirmation rather than inviting a second submit.
  const [resetSent, setResetSent] = useState<boolean>(false)

  // Reset the form each time the popup opens — PopupBase never unmounts its
  // children (it only toggles a class), so without this a cancelled attempt's
  // fields and error would still be there next time. Adjusted during render, the
  // same during-render pattern ColorPopup uses.
  const [wasOpen, setWasOpen] = useState<boolean>(isOpen)
  if (isOpen !== wasOpen) {
    setWasOpen(isOpen)
    if (isOpen) {
      setError(null)
      setPassword("")
      setSubmitting(false)
      setResetSent(false)
    }
  }

  const switchMode = (next: Mode) => {
    setMode(next)
    setError(null)
    setResetSent(false)
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
        : mode === "register"
          ? await onRegister(email, username, password)
          : await onRequestReset(email)

    setSubmitting(false)
    if (result.ok) {
      if (mode === "forgot") {
        // Non-enumerable endpoint: the same confirmation regardless of whether
        // the address had an account, so the popup can't be used to probe.
        setResetSent(true)
      } else {
        onClose()
      }
    } else {
      setError(result.error)
    }
  }

  const isLogin = mode === "login"
  const isForgot = mode === "forgot"
  const title = isForgot
    ? "Reset your password"
    : isLogin
      ? "Log in"
      : "Create an account"

  return (
    <PopupBase isOpen={isOpen} onClose={onClose} label={title}>
      <form className="auth-popup" onSubmit={handleSubmit}>
        <header className="auth-header">
          <h2>{title}</h2>
          <p>
            {isForgot
              ? "Enter your email and we'll send a link to set a new password."
              : isLogin
                ? "Log in to keep your saved colors across devices."
                : "Accounts save your color palette and show your name to others."}
          </p>
        </header>

        {isForgot && resetSent ? (
          <>
            <p className="auth-status" role="status">
              If that email has an account, a reset link is on its way. The link
              expires in an hour.
            </p>
            <button
              type="button"
              className="auth-submit"
              onClick={() => switchMode("login")}
            >
              Back to log in
            </button>
          </>
        ) : (
          <>
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

            {mode === "register" && (
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

            {!isForgot && (
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
            )}

            {/* Only offered from the login view — the one place someone who
                can't get in would look for it. */}
            {isLogin && (
              <p className="auth-forgot">
                <button type="button" onClick={() => switchMode("forgot")}>
                  Forgot password?
                </button>
              </p>
            )}

            {error && (
              <p className="auth-error" role="alert">
                {error}
              </p>
            )}

            <button type="submit" className="auth-submit" disabled={submitting}>
              {submitting
                ? "…"
                : isForgot
                  ? "Send reset link"
                  : isLogin
                    ? "Log in"
                    : "Register"}
            </button>
          </>
        )}

        <p className="auth-switch">
          {isForgot ? (
            <>
              Remembered it?{" "}
              <button type="button" onClick={() => switchMode("login")}>
                Log in
              </button>
            </>
          ) : isLogin ? (
            <>
              Need an account?{" "}
              <button type="button" onClick={() => switchMode("register")}>
                Register
              </button>
            </>
          ) : (
            <>
              Already have an account?{" "}
              <button type="button" onClick={() => switchMode("login")}>
                Log in
              </button>
            </>
          )}
        </p>
      </form>
    </PopupBase>
  )
}
//#endregion
