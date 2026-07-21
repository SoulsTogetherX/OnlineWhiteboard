//#region Imports
import type { ColorPalette } from "@shared/types/primitive"
import type { DrawAction } from "@shared/types/drawProtocol"
//#endregion

//#region Layout
// The desktop breakpoint. App reads it (via useMediaQuery) to choose the
// sidebar's initial open state — open on desktop, collapsed on a phone so the
// canvas isn't covered on load. The sidebar itself sizes with min(20rem, 85vw)
// rather than this query, so there is no CSS media query that must be kept in
// sync with this value any more.
export const DESKTOP_MEDIA_QUERY = "(min-width: 1024px)"
//#endregion

//#region Constants
export const DEFAULT_COLOR_PALETTE: ColorPalette = {
  primary: { r: 0, g: 0, b: 0, a: 255 },
  secondary: { r: 255, g: 255, b: 255, a: 255 },
}
export const DEFAULT_DRAW_ACTION: DrawAction = {
  type: "pencil",
}
//#endregion
