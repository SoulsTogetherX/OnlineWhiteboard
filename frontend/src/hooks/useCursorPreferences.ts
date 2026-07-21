//#region Imports
import { useCallback, useState } from "react"
//#endregion

//#region Storage
// Client-only display preferences for other people's cursors. Not a room
// setting — it's how THIS viewer wants their own screen to look, so it lives in
// localStorage (survives reloads, per-device) rather than on the server.
const STORAGE_KEY = "online-whiteboard-cursor-prefs"

export interface CursorPreferences {
  // When off, other cursors are hidden entirely (effectively transparent).
  showCursors: boolean
  // When off, cursors still show as an arrow but without the name label.
  showNames: boolean
}

const DEFAULTS: CursorPreferences = { showCursors: true, showNames: true }

function loadPreferences(): CursorPreferences {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw === null) {
      return DEFAULTS
    }
    const parsed = JSON.parse(raw) as Partial<CursorPreferences>
    // Read each field defensively — a hand-edited or older stored blob must not
    // yield `undefined` for a boolean the overlay treats as a flag.
    return {
      showCursors:
        typeof parsed.showCursors === "boolean"
          ? parsed.showCursors
          : DEFAULTS.showCursors,
      showNames:
        typeof parsed.showNames === "boolean"
          ? parsed.showNames
          : DEFAULTS.showNames,
    }
  } catch {
    return DEFAULTS
  }
}
//#endregion

//#region Hook Def
export interface UseCursorPreferencesResult extends CursorPreferences {
  setShowCursors: (value: boolean) => void
  setShowNames: (value: boolean) => void
}

export default function useCursorPreferences(): UseCursorPreferencesResult {
  // Read synchronously on first render so there is no frame with the default
  // before the stored value hydrates.
  const [preferences, setPreferences] = useState<CursorPreferences>(
    loadPreferences,
  )

  const update = useCallback((patch: Partial<CursorPreferences>) => {
    setPreferences((previous) => {
      const next = { ...previous, ...patch }
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
      } catch {
        // Persistence is a convenience; a full/blocked store must not break the
        // in-memory preference.
      }
      return next
    })
  }, [])

  const setShowCursors = useCallback(
    (value: boolean) => update({ showCursors: value }),
    [update],
  )
  const setShowNames = useCallback(
    (value: boolean) => update({ showNames: value }),
    [update],
  )

  return { ...preferences, setShowCursors, setShowNames }
}
//#endregion
