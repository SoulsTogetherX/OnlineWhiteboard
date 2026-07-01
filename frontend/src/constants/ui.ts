//#region Imports
import type { ColorPallet } from "../types/colorPallet"
import type { DrawAction } from "../types/drawAction"
//#endregion

//#region Constants
const defaultColorPallet: ColorPallet = {
  primary: { r: 255, g: 0, b: 0, a: 255 },
  secondary: { r: 0, g: 0, b: 255, a: 255 },
}
const defaultDrawAction: DrawAction = {
  type: "pencil",
}
//#endregion

//#region Exports
export { defaultColorPallet, defaultDrawAction }
//#endregion
