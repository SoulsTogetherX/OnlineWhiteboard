//#region Imports
import { getDrawerMethod, getLookAtMethod } from "./helperProtocallMethods"

import type { PatchEntry, PatchInstruction } from "../types/drawProtocol"
import type { ColorType } from "../types/primitive"
//#endregion

//#region Helper Method
function colorsEqual(a: ColorType, b: ColorType): boolean {
  return a.r === b.r && a.g === b.g && a.b === b.b && a.a === b.a
}
//#endregion

//#region Handle Methods
// Compare-and-swap apply: an entry only lands if the pixel still holds the
// color this patch expects to move it *from*. Anything that no longer
// matches — because someone else painted over it since — is left alone.
// Returns the subset that actually got applied so the caller (server: what
// to broadcast; client: what to push onto the opposite undo/redo stack, and
// whether to flag a partial undo) always reflects what really happened,
// never what was merely requested.
export function handleDrawPatchInstruction(
  pixels: ImageData | Uint8ClampedArray<ArrayBufferLike>,
  inst: PatchInstruction,
): PatchEntry[] {
  const getColor = getLookAtMethod(inst.type, pixels)
  const setColor = getDrawerMethod(inst.type, pixels)

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
