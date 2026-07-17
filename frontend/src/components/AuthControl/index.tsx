//#region Imports
import type { AuthUser } from "@shared/types/identity"

import "./styles.css"
//#endregion

//#region Component
export interface AuthControlProps {
  user: AuthUser | null
  isLoading: boolean
  onOpenAuth: () => void
  onLogout: () => void
}

// Sits in the corner and reflects auth state: a "Log in" button while a guest,
// or the account's name + colour dot with a "Log out" button once signed in.
export default function AuthControl({
  user,
  isLoading,
  onOpenAuth,
  onLogout,
}: AuthControlProps) {
  // Avoid a flash of "Log in" before /api/auth/me resolves on first load.
  if (isLoading) {
    return <div className="auth-control" aria-hidden="true" />
  }

  if (!user) {
    return (
      <div className="auth-control">
        <button type="button" className="auth-login-button" onClick={onOpenAuth}>
          Log in
        </button>
      </div>
    )
  }

  return (
    <div className="auth-control">
      <span className="auth-identity">
        <span
          className="auth-color-dot"
          style={{ backgroundColor: user.color }}
          aria-hidden="true"
        />
        <span className="auth-username">{user.username}</span>
      </span>
      <button type="button" className="auth-logout-button" onClick={onLogout}>
        Log out
      </button>
    </div>
  )
}
//#endregion
