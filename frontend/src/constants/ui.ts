//#region Imports
import type { ColorPallet } from "@shared/types/primitive"
import type { DrawAction } from "@shared/types/drawProtocol"
//#endregion

//#region Constants
export const DEFAULT_COLOR_PALLET: ColorPallet = {
  primary: { r: 0, g: 0, b: 0, a: 255 },
  secondary: { r: 255, g: 255, b: 255, a: 255 },
}
export const DEFAULT_DRAW_ACTION: DrawAction = {
  type: "pencil",
}
//#endregion
