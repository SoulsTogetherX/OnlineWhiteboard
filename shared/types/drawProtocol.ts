//#region Imports
import type { Vec, ColorType } from "./primitive"
//#endregion

//#region Summery Types
export type LineToolType = "pencil" | "eraser"
export type FillToolType = "bucket"
export type ToolType = LineToolType | FillToolType

export type LineAction = PencilAction | EraseAction
export type FillAction = BucketAction
export type DrawAction = LineAction | FillAction

export type LineInstruction = PencilInstruction | EraseInstruction
export type FillInstruction = BucketInstruction
export type DrawInstruction = LineInstruction | FillInstruction
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
  prevPos?: Vec
  nextPos?: Vec
}
export type PencilAction = PencilShared & BaseAction
export type PencilInstruction = PencilShared & BaseInstruction

type EraseShared = {
  type: "eraser"
  prevPos?: Vec
  nextPos?: Vec
}
export type EraseAction = EraseShared & BaseAction
export type EraseInstruction = EraseShared & BaseInstruction

type BucketShared = {
  type: "bucket"
  pos?: Vec
}
export type BucketAction = BucketShared & BaseAction
export type BucketInstruction = BucketShared & BaseInstruction
//#endregion
