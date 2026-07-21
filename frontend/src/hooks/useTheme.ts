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
// A stored choice wins; otherwise follow the OS preference so first-time dark-mode
// users get dark without touching anything.
function initialTheme(): Theme {
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
