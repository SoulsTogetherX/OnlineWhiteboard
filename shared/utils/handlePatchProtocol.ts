//#region Imports
import { getDrawerMethod, getLookAtMethod } from "./helperProtocolMethods"
import { colorsEqual } from "../types/primitive"

import type { PatchEntry, PatchInstruction } from "../types/drawProtocol"
import type { PatchApplyMode } from "./handleCanvasProtocol"
//#endregion

//#region Handle Methods
// In "decide" mode this is a compare-and-swap apply: an entry only lands if the
// pixel still holds the color this patch expects to move it *from*. Anything
// that no longer matches — because someone else painted over it since — is left
// alone. The returned subset is what actually applied, so the caller (server:
// what to broadcast; local undo: what to push onto the opposite stack, and
// whether to flag a partial undo) reflects what really happened, never what was
// merely requested.
//
// In "replay" mode every entry is applied unconditionally. See PatchApplyMode in
// handleCanvasProtocol.ts for why re-running the CAS on an already-decided patch
// is not merely wasteful but actively desynchronising.
export function handleDrawPatchInstruction(
  pixels: ImageData | Uint8ClampedArray<ArrayBufferLike>,
  inst: PatchInstruction,
  mode: PatchApplyMode = "decide",
): PatchEntry[] {
  const getColor = getLookAtMethod(inst.type, pixels)
  const setColor = getDrawerMethod(inst.type, pixels)

  if (mode === "replay") {
    for (const entry of inst.entries) {
      setColor(entry.idx, entry.to)
    }
    return inst.entries
  }

  const applied: PatchEntry[] = []
  for (const entry of inst.entries) {
    if (colorsEqual(getColor(entry.idx), entry.from)) {
      setColor(entry.idx, entry.to)
      applied.push(entry)
    }
  }
  return applied
}
//#endregion
