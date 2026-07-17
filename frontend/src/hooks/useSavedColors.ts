//#region Imports
import { useCallback, useEffect, useState } from "react"

import type { AuthUser } from "@shared/types/identity"
//#endregion

//#region Constants
const GUEST_STORAGE_KEY = "online-whiteboard-saved-colors"
const MAX_SAVED = 24
//#endregion

//#region Storage helpers (guest)
function loadGuest(): string[] {
  try {
    const raw = localStorage.getItem(GUEST_STORAGE_KEY)
    const parsed = raw ? JSON.parse(raw) : []
    return Array.isArray(parsed) ? parsed.filter((c) => typeof c === "string") : []
  } catch {
    return []
  }
}

function saveGuest(colors: string[]): void {
  try {
    localStorage.setItem(GUEST_STORAGE_KEY, JSON.stringify(colors))
  } catch {
    /* ignore */
  }
}

async function api(
  method: "GET" | "POST" | "DELETE",
  color?: string,
): Promise<string[] | null> {
  const res = await fetch("/api/colors", {
    method,
    credentials: "same-origin",
    headers: color ? { "Content-Type": "application/json" } : undefined,
    body: color ? JSON.stringify({ color }) : undefined,
  })
  if (!res.ok) {
    return null
  }
  const data = await res.json().catch(() => null)
  return Array.isArray(data?.colors) ? data.colors : []
}
//#endregion

//#region Hook
// The saved palette. When logged in it lives on the account (the /api/colors
// endpoints), so it follows you across devices; as a guest it falls back to
// localStorage. Switching between the two happens automatically when `user`
// changes — logging in loads your account palette, logging out reveals the local
// one.
export default function useSavedColors(user: AuthUser | null): {
  saved: string[]
  addSaved: (hex8: string) => void
  removeSaved: (hex8: string) => void
} {
  const isLoggedIn = user !== null
  const [saved, setSaved] = useState<string[]>(() =>
    isLoggedIn ? [] : loadGuest(),
  )

  // Reset when the login identity changes. The guest palette is synchronous
  // (localStorage), so it's applied during render — the recommended pattern for
  // "reset state when a prop changes", and it avoids a setState-in-effect. The
  // logged-in palette is async, so the fetch stays in the effect below.
  const userKey = user?.id ?? null
  const [lastUserKey, setLastUserKey] = useState<string | null>(userKey)
  if (userKey !== lastUserKey) {
    setLastUserKey(userKey)
    setSaved(isLoggedIn ? [] : loadGuest())
  }

  useEffect(() => {
    if (!isLoggedIn) {
      return
    }
    let cancelled = false
    api("GET").then((colors) => {
      if (!cancelled) setSaved(colors ?? [])
    })
    return () => {
      cancelled = true
    }
  }, [isLoggedIn, user?.id])

  const addSaved = useCallback(
    (hex8: string) => {
      if (isLoggedIn) {
        api("POST", hex8).then((colors) => {
          if (colors) setSaved(colors)
        })
      } else {
        setSaved((prev) => {
          if (prev.includes(hex8)) return prev
          const next = [...prev, hex8].slice(-MAX_SAVED)
          saveGuest(next)
          return next
        })
      }
    },
    [isLoggedIn],
  )

  const removeSaved = useCallback(
    (hex8: string) => {
      if (isLoggedIn) {
        api("DELETE", hex8).then((colors) => {
          if (colors) setSaved(colors)
        })
      } else {
        setSaved((prev) => {
          const next = prev.filter((c) => c !== hex8)
          saveGuest(next)
          return next
        })
      }
    },
    [isLoggedIn],
  )

  return { saved, addSaved, removeSaved }
}
//#endregion
