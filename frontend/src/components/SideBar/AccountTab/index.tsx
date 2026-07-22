//#region Imports
import { useState } from "react"

import type { AuthUser } from "@shared/types/identity"

import "./styles.css"
//#endregion

//#region Component Def
export interface AccountTabProps {
  user: AuthUser | null
  onOpenAuth: () => void
  onLogout: () => void
  onUpdateUsername: (username: string) => Promise<{ ok: boolean; error?: string }>
  onDeleteAccount: () => Promise<{ ok: boolean; error?: string }>
}

// Everything about WHO you are, in one place. Account controls used to be spread
// between the top-right corner and the foot of the Room tab, which mixed "who am
// I" with "what is this room" — two things you change at completely different
// times.
export default function AccountTab({
  user,
  onOpenAuth,
  onLogout,
  onUpdateUsername,
  onDeleteAccount,
}: AccountTabProps) {
  const [draftName, setDraftName] = useState(user?.username ?? "")
  // Re-seed the field when the account changes underneath it — signing in as
  // someone else, or another tab renaming this account. The during-render reset
  // pattern used elsewhere in the sidebar, rather than an effect.
  const [seenName, setSeenName] = useState(user?.username ?? "")
  if ((user?.username ?? "") !== seenName) {
    setSeenName(user?.username ?? "")
    setDraftName(user?.username ?? "")
  }

  const [status, setStatus] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  // Deleting an account is irreversible, so it takes a second, deliberate click
  // rather than a browser confirm() — which is easy to dismiss by reflex and
  // impossible to style or test.
  const [confirmingDelete, setConfirmingDelete] = useState(false)

  if (!user) {
    return (
      <div className="account-tab">
        <p className="account-guest">
          You are drawing as a guest. Signing in keeps your name, your colour and
          your saved palette across devices.
        </p>
        <button type="button" className="account-button account-button-primary" onClick={onOpenAuth}>
          Log in or register
        </button>
      </div>
    )
  }

  const trimmed = draftName.trim()
  const nameChanged = trimmed.length > 0 && trimmed !== user.username

  const submitName = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!nameChanged || busy) {
      return
    }
    setBusy(true)
    setError(null)
    setStatus(null)
    const result = await onUpdateUsername(trimmed)
    setBusy(false)
    if (result.ok) {
      setStatus("Name updated.")
    } else {
      setError(result.error ?? "Could not change your name.")
    }
  }

  const confirmDelete = async () => {
    setBusy(true)
    setError(null)
    const result = await onDeleteAccount()
    setBusy(false)
    if (!result.ok) {
      setConfirmingDelete(false)
      setError(result.error ?? "Could not delete your account.")
    }
    // On success the user becomes null and this component re-renders as the
    // signed-out view, so there is nothing to clean up here.
  }

  return (
    <div className="account-tab">
      <section className="account-identity" aria-label="Signed in as">
        <span
          className="account-dot"
          style={{ backgroundColor: user.color }}
          aria-hidden="true"
        />
        <span className="account-name">{user.username}</span>
      </section>

      <form className="account-rename" onSubmit={submitName}>
        <label className="account-label" htmlFor="account-name-input">
          Display name
        </label>
        <div className="account-rename-row">
          <input
            id="account-name-input"
            type="text"
            value={draftName}
            onChange={(event) => {
              setDraftName(event.target.value)
              setStatus(null)
              setError(null)
            }}
            maxLength={32}
            autoComplete="off"
          />
          <button type="submit" disabled={!nameChanged || busy}>
            Save
          </button>
        </div>
        <p className="account-hint">
          This is the name other people see on your cursor.
        </p>
      </form>

      {status && (
        <p className="account-status" role="status">
          {status}
        </p>
      )}
      {error && (
        <p className="account-error" role="alert">
          {error}
        </p>
      )}

      <button
        type="button"
        className="account-button"
        onClick={onLogout}
        disabled={busy}
      >
        Log out
      </button>

      <section className="account-danger" aria-label="Delete account">
        {confirmingDelete ? (
          <>
            <p className="account-danger-warning">
              This deletes your account for good. Rooms you own become unowned;
              drawings stay.
            </p>
            <div className="account-danger-row">
              <button
                type="button"
                className="account-button"
                onClick={() => setConfirmingDelete(false)}
                disabled={busy}
              >
                Cancel
              </button>
              <button
                type="button"
                className="account-button account-button-danger"
                onClick={confirmDelete}
                disabled={busy}
              >
                Delete for good
              </button>
            </div>
          </>
        ) : (
          <button
            type="button"
            className="account-button account-button-danger"
            onClick={() => setConfirmingDelete(true)}
            disabled={busy}
          >
            Delete account
          </button>
        )}
      </section>
    </div>
  )
}
//#endregion
