//#region Imports
import { useCallback, useState } from "react"

import { loadStringArray, saveStringArray } from "@/utils/localStorageArray"
//#endregion

//#region Constants
const STORAGE_KEY = "online-whiteboard-recent-colors"
const MAX_RECENT = 12
//#endregion

//#region Storage helpers
const load = (): string[] => loadStringArray(STORAGE_KEY)
const save = (colors: string[]): void => saveStringArray(STORAGE_KEY, colors)
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
