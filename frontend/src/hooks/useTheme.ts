//#region Imports
import { useCallback, useEffect, useState } from "react"
//#endregion

//#region Constants
// localStorage (not session): the theme is a whole-browser preference, shared
// across tabs and remembered between visits.
const THEME_KEY = "online-whiteboard-theme"
//#endregion

//#region Type Def
export type Theme = "light" | "dark"

export interface UseThemeResult {
  theme: Theme
  toggle: () => void
}
//#endregion

//#region Helper
// What theme is already on screen.
//
// The attribute is checked FIRST, because by the time React runs the answer has
// already been decided and painted: public/theme-boot.js is a blocking script in
// <head> that resolves the theme and stamps `data-theme` before the browser
// paints anything. Recomputing here rather than reading it back would be two
// implementations of one decision, free to disagree — and a disagreement shows
// up as exactly the flash that script exists to prevent.
//
// The rest is the same resolution the boot script performs, kept for the cases
// where it did not run: jsdom in the unit tests, and any future server render.
// If the order or the storage key changes here, change public/theme-boot.js to
// match — a classic blocking script cannot import from a module without becoming
// one, and becoming one would defer it, which is the whole bug.
function initialTheme(): Theme {
  if (typeof document !== "undefined") {
    const stamped = document.documentElement.getAttribute("data-theme")
    if (stamped === "light" || stamped === "dark") {
      return stamped
    }
  }

  try {
    const stored = localStorage.getItem(THEME_KEY)
    if (stored === "light" || stored === "dark") {
      return stored
    }
  } catch {
    // localStorage can throw (private mode) — fall through to the OS preference.
  }
  return typeof window !== "undefined" &&
    window.matchMedia?.("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light"
}
//#endregion

//#region Hook Def
// Owns the light/dark theme. Stamps `data-theme` on <html>, which the CSS
// variables in styles.css key off, and persists the choice.
export default function useTheme(): UseThemeResult {
  const [theme, setTheme] = useState<Theme>(initialTheme)

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme)
    try {
      localStorage.setItem(THEME_KEY, theme)
    } catch {
      // Persistence is a convenience; the in-memory theme is still applied.
    }
  }, [theme])

  const toggle = useCallback(
    () => setTheme((current) => (current === "dark" ? "light" : "dark")),
    [],
  )

  return { theme, toggle }
}
//#endregion
