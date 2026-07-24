//#region Imports
import { useState } from "react"

import PopupBase from "@/components/Popups/PopupBase"

import type { AuthResult } from "@/hooks/useAuth"

// Reuses the AuthPopup styles so the two auth forms look identical — this is the
// second half of the password-reset flow the AuthPopup starts, and sharing the
// stylesheet keeps them from drifting apart visually.
import "@/components/Popups/AuthPopup/styles.css"
//#endregion

//#region Component
export interface ResetPasswordPopupProps {
  isOpen: boolean
  onClose: () => void
  // Redeems the emailed token with the chosen password. Returns an error to show
  // (bad/expired link, weak or breached password) or ok on success.
  onSubmit: (password: string) => Promise<AuthResult>
  // Offered after a successful reset, so the user can go straight to logging in
  // with the new password (the server invalidated every session, so they must).
  onGoToLogin: () => void
}

// The "set a new password" step, opened by App when the URL carries a ?reset=
// token from the emailed link. The token itself lives in App (it came from the
// URL); this component only collects the new password and reports the outcome.
export default function ResetPasswordPopup({
  isOpen,
  onClose,
  onSubmit,
  onGoToLogin,
}: ResetPasswordPopupProps) {
  const [password, setPassword] = useState<string>("")
  const [confirm, setConfirm] = useState<string>("")
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState<boolean>(false)
  const [done, setDone] = useState<boolean>(false)

  // Clear the fields whenever the popup opens (PopupBase keeps children mounted).
  const [wasOpen, setWasOpen] = useState<boolean>(isOpen)
  if (isOpen !== wasOpen) {
    setWasOpen(isOpen)
    if (isOpen) {
      setPassword("")
      setConfirm("")
      setError(null)
      setSubmitting(false)
      setDone(false)
    }
  }

  const handleSubmit = async (ev: React.FormEvent) => {
    ev.preventDefault()
    if (submitting) {
      return
    }
    // Cheap client-side check so an obvious mismatch never spends a request; the
    // server is still the authority on strength and breach status.
    if (password !== confirm) {
      setError("The two passwords don't match.")
      return
    }
    setSubmitting(true)
    setError(null)

    const result = await onSubmit(password)
    setSubmitting(false)
    if (result.ok) {
      setDone(true)
    } else {
      setError(result.error)
    }
  }

  return (
    <PopupBase isOpen={isOpen} onClose={onClose} label="Set a new password">
      <form className="auth-popup" onSubmit={handleSubmit}>
        <header className="auth-header">
          <h2>Set a new password</h2>
          <p>
            {done
              ? "Your password has been reset."
              : "Choose a new password for your account."}
          </p>
        </header>

        {done ? (
          <>
            <p className="auth-status" role="status">
              You can now log in with your new password. For your security, every
              other session has been signed out.
            </p>
            <button type="button" className="auth-submit" onClick={onGoToLogin}>
              Log in
            </button>
          </>
        ) : (
          <>
            <label className="auth-field">
              <span>New password</span>
              <input
                type="password"
                name="password"
                autoComplete="new-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                minLength={8}
                required
              />
            </label>

            <label className="auth-field">
              <span>Confirm new password</span>
              <input
                type="password"
                name="confirm-password"
                autoComplete="new-password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
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
              {submitting ? "…" : "Reset password"}
            </button>
          </>
        )}
      </form>
    </PopupBase>
  )
}
//#endregion
