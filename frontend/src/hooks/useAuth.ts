//#region Imports
import { useCallback, useEffect, useRef, useState } from "react"

import type { AuthUser } from "@shared/types/identity"
//#endregion

//#region Type Defs
export type AuthResult = { ok: true } | { ok: false; error: string }

export interface UseAuthResult {
  user: AuthUser | null
  isLoading: boolean
  login: (email: string, password: string) => Promise<AuthResult>
  register: (
    email: string,
    username: string,
    password: string,
  ) => Promise<AuthResult>
  logout: () => Promise<void>
  // Both scoped to the caller by the session cookie alone — neither takes a
  // user id, so neither can act on somebody else's account.
  updateUsername: (username: string) => Promise<AuthResult>
  deleteAccount: () => Promise<AuthResult>
}
//#endregion

//#region Constants
// Same-browser tabs share ONE session cookie, so a login/logout in any tab
// changes what every tab's socket resolves to on its next (re)connect. This
// channel tells the other tabs to re-read the session so their UI and reconnect
// key agree with the cookie (see the cross-tab effect below).
const AUTH_CHANNEL = "whiteboard-auth"
//#endregion

//#region Helpers
// The two possible JSON bodies the auth endpoints return: a user (success) or an
// error message (4xx/5xx). Logout returns 204 with no body.
type AuthResponse = { user?: AuthUser | null; error?: string }

// Every call is same-origin, so the session cookie rides along automatically —
// but `credentials: "same-origin"` is stated explicitly so a future move to a
// separate API origin fails loudly (needing "include" + CORS) rather than
// silently dropping auth.
async function sendJson(
  url: string,
  body: unknown,
  method: "POST" | "PATCH" = "POST",
): Promise<{ status: number; data: AuthResponse | null }> {
  const res = await fetch(url, {
    method,
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })
  const data: AuthResponse | null =
    res.status === 204 ? null : await res.json().catch(() => null)
  return { status: res.status, data }
}
//#endregion

//#region Hook
export default function useAuth(): UseAuthResult {
  const [user, setUser] = useState<AuthUser | null>(null)
  const [isLoading, setIsLoading] = useState<boolean>(true)
  const channelRef = useRef<BroadcastChannel | null>(null)

  // Re-read whether this browser has a live session. Shared by the initial load
  // and by the cross-tab sync — always reflects the shared cookie's truth.
  const refresh = useCallback(async (): Promise<void> => {
    try {
      const res = await fetch("/api/auth/me", { credentials: "same-origin" })
      const data = await res.json()
      setUser(data?.user ?? null)
    } catch {
      setUser(null)
    }
  }, [])

  // On load, resolve the current session.
  useEffect(() => {
    let cancelled = false
    fetch("/api/auth/me", { credentials: "same-origin" })
      .then((res) => res.json())
      .then((data) => {
        if (!cancelled) {
          setUser(data?.user ?? null)
        }
      })
      .catch(() => {
        if (!cancelled) {
          setUser(null)
        }
      })
      .finally(() => {
        if (!cancelled) {
          setIsLoading(false)
        }
      })
    return () => {
      cancelled = true
    }
  }, [])

  // Cross-tab sync. Each tab's `user` is local React state, so before this a
  // guest tab kept a stale guest UI while its socket silently flipped to the
  // account on the next reconnect (the cookie is browser-wide). When ANY tab
  // logs in/out it posts here; the others re-read /api/auth/me, which updates
  // their UI AND (via user.id -> reconnectKey) reconnects their socket so the
  // server re-resolves identity — keeping every tab consistent.
  useEffect(() => {
    if (typeof BroadcastChannel === "undefined") {
      return
    }
    const channel = new BroadcastChannel(AUTH_CHANNEL)
    channel.onmessage = () => {
      void refresh()
    }
    channelRef.current = channel
    return () => {
      channelRef.current = null
      channel.close()
    }
  }, [refresh])

  // Tell the other tabs their session may have changed. The receiver re-reads
  // and does NOT re-broadcast, so there is no echo loop.
  const announce = useCallback(() => {
    channelRef.current?.postMessage("auth-changed")
  }, [])

  const login = useCallback(
    async (email: string, password: string): Promise<AuthResult> => {
      const { status, data } = await sendJson("/api/auth/login", {
        email,
        password,
      })
      if (status === 200 && data?.user) {
        setUser(data.user)
        announce()
        return { ok: true }
      }
      return { ok: false, error: data?.error ?? "Could not log in." }
    },
    [announce],
  )

  const register = useCallback(
    async (
      email: string,
      username: string,
      password: string,
    ): Promise<AuthResult> => {
      const { status, data } = await sendJson("/api/auth/register", {
        email,
        username,
        password,
      })
      if (status === 201 && data?.user) {
        setUser(data.user)
        announce()
        return { ok: true }
      }
      return { ok: false, error: data?.error ?? "Could not create account." }
    },
    [announce],
  )

  // Rename. The endpoint takes no user id — the session decides whose name
  // changes — so this cannot rename anyone but the caller.
  const updateUsername = useCallback(
    async (username: string): Promise<AuthResult> => {
      const { status, data } = await sendJson(
        "/api/auth/me",
        { username },
        "PATCH",
      )
      if (status === 200 && data?.user) {
        setUser(data.user)
        // Other tabs show this name too (the presence roster, the account tab),
        // so they need to re-read rather than keep the old one.
        announce()
        return { ok: true }
      }
      return { ok: false, error: data?.error ?? "Could not change your name." }
    },
    [announce],
  )

  // Irreversible. The server closes this session's sockets before deleting the
  // row, so there is no window where a live connection acts as a user who no
  // longer exists.
  const deleteAccount = useCallback(async (): Promise<AuthResult> => {
    const res = await fetch("/api/auth/me", {
      method: "DELETE",
      credentials: "same-origin",
    })
    if (res.status === 204) {
      setUser(null)
      announce()
      return { ok: true }
    }
    const data: AuthResponse | null = await res.json().catch(() => null)
    return { ok: false, error: data?.error ?? "Could not delete your account." }
  }, [announce])

  const logout = useCallback(async (): Promise<void> => {
    await fetch("/api/auth/logout", {
      method: "POST",
      credentials: "same-origin",
    })
    setUser(null)
    announce()
  }, [announce])

  return {
    user,
    isLoading,
    login,
    register,
    logout,
    updateUsername,
    deleteAccount,
  }
}
//#endregion
