//#region Imports
import type { ColorPalette } from "@shared/types/primitive"
import type { DrawAction } from "@shared/types/drawProtocol"
//#endregion

//#region Layout
// The desktop breakpoint. The toolbar is permanently visible at or above this
// width, and the hamburger is hidden.
//
// MUST stay in sync with the `min-width` media queries in
// components/ToolMenu/styles.css and components/HamburgerButton/styles.css.
// CSS can't read a TS constant, so this pairing is by convention — if you change
// one, change all three.
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
