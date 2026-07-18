//#region Imports
import type { Vec, ColorType } from "./primitive"
//#endregion

//#region Summery Types
export type LineToolType = "pencil" | "eraser"
export type FillToolType = "bucket"
export type SprayToolType = "spray"
export type ToolType = LineToolType | FillToolType | SprayToolType

export type LineAction = PencilAction | EraseAction
export type FillAction = BucketAction
export type DrawAction = LineAction | FillAction | SprayAction

export type LineInstruction = PencilInstruction | EraseInstruction
export type FillInstruction = BucketInstruction
export type DrawInstruction =
  | LineInstruction
  | FillInstruction
  | SprayInstruction
  | PatchInstruction
  | ClearInstruction
//#endregion

//#region Base Draw Action Types
export type BaseAction = {
  type: ToolType
}
export type BaseInstruction = {
  color?: ColorType
  // Brush diameter in canvas pixels. Optional on the wire (absent means 1, the
  // original single-pixel behaviour), and only the line tools and the spray can
  // read it — bucket and patch ignore it.
  size?: number
  instructionId: number
  sessionId: string
}
//#endregion

//#region Draw Action Types
// An Action and an Instruction carry the same fields but make different
// promises. An Action is a gesture *in progress*: the toolbar creates one
// holding nothing but a `type`, and the pointer handlers fill its positions
// in as the gesture runs — so positions are Partial. An Instruction is a
// *completed* fact on its way to the wire, so its positions are guaranteed.
// Keeping both guarantees in one shared type is what made `{ type: "pencil" }`
// fail to typecheck, and what left the `!action.prevPos` / `action.pos ?? [0,0]`
// guards in the draw handlers unreachable.
type PencilShared = {
  type: "pencil"
}
type PencilPositions = {
  prevPos: Vec
  nextPos: Vec
}
export type PencilAction = PencilShared & BaseAction & Partial<PencilPositions>
export type PencilInstruction = PencilShared &
  BaseInstruction &
  BaseAction &
  PencilPositions

type EraseShared = {
  type: "eraser"
}
type ErasePositions = {
  prevPos: Vec
  nextPos: Vec
}
export type EraseAction = EraseShared & BaseAction & Partial<ErasePositions>
export type EraseInstruction = EraseShared &
  BaseInstruction &
  BaseAction &
  ErasePositions

type BucketShared = {
  type: "bucket"
}
type BucketPositions = {
  pos: Vec
}
export type BucketAction = BucketShared & BaseAction & Partial<BucketPositions>
export type BucketInstruction = BucketShared &
  BaseInstruction &
  BaseAction &
  BucketPositions

// The spray can. A gesture emits one "puff" per pointer sample: `density`
// pixels scattered within `radius` of `pos`, positioned by a seeded PRNG. The
// `seed` is the whole trick — it's chosen on the client and sent, so the server
// and every other client reproduce the identical splatter (see utils/random.ts).
type SprayShared = {
  type: "spray"
}
type SprayFields = {
  pos: Vec
  radius: number
  density: number
  seed: number
}
export type SprayAction = SprayShared & BaseAction & Partial<SprayFields>
export type SprayInstruction = SprayShared &
  BaseInstruction &
  BaseAction &
  SprayFields
//#endregion

//#region Patch Instruction (undo/redo)
// Not a BaseAction/ToolType — patches are never picked from the toolbar,
// they're generated locally by undo/redo. Each entry is a compare-and-swap:
// applying it only takes effect where the pixel currently equals `from`,
// which is what makes undo safe against another client having drawn over
// the same area in the meantime.
export type PatchEntry = {
  idx: number
  from: ColorType
  to: ColorType
}
export type PatchInstruction = {
  type: "patch"
  entries: PatchEntry[]
} & BaseInstruction
//#endregion

//#region Clear Instruction (room action)
// Blanks the whole canvas. Like patch it isn't a toolbar tool — it is applied by
// the SERVER after a vote resolves, then flows through the event log and
// broadcast as a normal "draw" so recovery and every client handle it the same
// way as any other instruction. Clients are NOT allowed to send this directly
// (the server rejects a client-originated clear); the only path to it is the
// vote flow, which is what stops one person wiping a shared board.
export type ClearInstruction = {
  type: "clear"
} & BaseInstruction
//#endregion
