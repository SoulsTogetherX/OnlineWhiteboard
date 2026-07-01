//#region Imports
import type { Vec } from "./vector"
//#endregion

//#region Type Def
type ToolType = "pencil"
type BaseAction = {
  type: ToolType
}

type PencilAction = BaseAction & {
  type: "pencil"

  prevPos?: Vec
  nextPos?: Vec
}

type DrawAction = PencilAction
//#endregion

//#region Exports
export type { ToolType, DrawAction, PencilAction }
//#endregion
