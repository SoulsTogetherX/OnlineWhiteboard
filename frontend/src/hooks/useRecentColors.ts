//#region Imports
import { useCallback, useState } from "react"
//#endregion

//#region Constants
const STORAGE_KEY = "online-whiteboard-recent-colors"
const MAX_RECENT = 12
//#endregion

//#region Storage helpers
function load(): string[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    const parsed = raw ? JSON.parse(raw) : []
    return Array.isArray(parsed) ? parsed.filter((c) => typeof c === "string") : []
  } catch {
    return []
  }
}

function save(colors: string[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(colors))
  } catch {
    /* private mode / quota — recents are a nicety, not worth surfacing */
  }
}
//#endregion

//#region Hook
// Recently-used colours, most-recent first. Always local to the browser and
// always on (no account needed) — this is a usage history, distinct from the
// saved palette which is a deliberate, account-backed shortlist.
export default function useRecentColors(): {
  recent: string[]
  addRecent: (hex8: string) => void
} {
  const [recent, setRecent] = useState<string[]>(load)

  const addRecent = useCallback((hex8: string) => {
    setRecent((prev) => {
      // Move-to-front, dedup, cap.
      const next = [hex8, ...prev.filter((c) => c !== hex8)].slice(0, MAX_RECENT)
      save(next)
      return next
    })
  }, [])

  return { recent, addRecent }
}
//#endregion
