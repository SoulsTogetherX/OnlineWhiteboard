//#region Imports
import type { Vec, ColorType } from "./primitive"
//#endregion

//#region Summery Types
export type LineToolType = "pencil" | "eraser" | "spray"
export type PointToolType = "bucket"
export type ToolType = LineToolType | PointToolType

export type LineAction = PencilAction | EraseAction | SprayAction
export type PointAction = BucketAction
export type DrawAction = LineAction | PointAction

export type LineInstruction =
  | PencilInstruction
  | EraseInstruction
  | SprayInstruction
export type PointInstruction = BucketInstruction
export type DrawInstruction = LineInstruction | PointInstruction
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

type SprayShared = {
  type: "spray"
  prevPos?: Vec
  nextPos?: Vec
}
export type SprayAction = SprayShared & BaseAction
export type SprayInstruction = SprayShared & BaseInstruction

type BucketShared = {
  type: "bucket"
}
export type BucketAction = BucketShared & BaseAction
export type BucketInstruction = BucketShared & BaseInstruction
//#endregion
