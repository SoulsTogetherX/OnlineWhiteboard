//#region Imports
import { useCallback, useSyncExternalStore } from "react"
//#endregion

//#region Hook Def
// Reports whether a CSS media query currently matches, and re-renders when that
// changes.
//
// Needed because the toolbar's visibility was previously decided in two places
// that disagreed: React tracked `isToolbarOpen`, while ToolMenu's CSS forced the
// menu visible at >=1024px regardless. That split is what let the "hamburger
// can't open the toolbar" bug hide on desktop — the state was wrong, but the
// CSS overrode it, so nobody noticed until a phone-sized viewport removed the
// override. Now one boolean drives both.
//
// Implemented with useSyncExternalStore rather than useState + useEffect.
// matchMedia is an external mutable store, and that is precisely what this hook
// is for: it subscribes, reads the value during render (so there is no
// first-paint frame with a stale default), and is safe under concurrent
// rendering — a useEffect version can tear, because the viewport can change
// between render and effect commit.
export default function useMediaQuery(query: string): boolean {
  const subscribe = useCallback(
    (onStoreChange: () => void) => {
      const mediaQueryList = window.matchMedia(query)
      mediaQueryList.addEventListener("change", onStoreChange)
      return () => mediaQueryList.removeEventListener("change", onStoreChange)
    },
    [query],
  )

  const getSnapshot = useCallback(() => window.matchMedia(query).matches, [query])

  return useSyncExternalStore(subscribe, getSnapshot)
}
//#endregion
