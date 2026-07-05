//#region Imports
import type { Vec, ColorType } from "./primitive"
//#endregion

//#region Summery Types
export type ToolType = "pencil"
export type DrawAction = PencilAction
export type DrawInstruction = PencilInstruction
//#endregion

//#region Base Draw Action Types
export type BaseAction = {
  type: ToolType
}
export type BaseInstruction = BaseAction & {
  color: ColorType
}
//#endregion

//#region Draw Action Types
type PencilShared = {
  type: "pencil"
}
export type PencilAction = BaseAction &
  PencilShared & {
    prevPos?: Vec
    nextPos?: Vec
  }
export type PencilInstruction = BaseInstruction &
  PencilShared & {
    prevPos: Vec
    nextPos: Vec
  }
//#endregion
