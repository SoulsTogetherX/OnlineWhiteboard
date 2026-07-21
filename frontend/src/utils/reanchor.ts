//#region Why this exists
// When a room is resized, the undo/redo stacks are NOT thrown away — they are
// re-anchored to the new canvas size. Each undo entry is a compare-and-swap keyed
// by a raw BYTE index into the RGBA buffer, and that index encodes the row
// stride (idx = (y * width + x) * 4). A resize changes the width, so every stored
// index would point at the wrong pixel on the new canvas unless it is remapped.
//
// The remap is top-left anchored, matching how the pixels themselves are resized
// (resizePixels crops/pads from the top-left): a pixel keeps its (x, y) and only
// its stride changes. So an entry's recorded colour is still the value at that
// pixel — the CAS stays valid — and only entries whose pixel no longer EXISTS
// (cropped away by a shrink) are dropped. Growing keeps every entry; shrinking
// keeps the entries inside the new bounds.
//
// Pure and DOM-free so it is unit-tested without a canvas or React; useUndoRedo
// is the thin caller.
//#endregion

//#region Imports
import type { CanvasDims } from "@shared/constants/canvas"
import type { PatchEntry } from "@shared/types/drawProtocol"
//#endregion

//#region Reanchor
// Remaps a byte index from `from` dimensions to `to`, top-left anchored, or null
// if that pixel falls outside the new canvas. `idx` is a 4-byte-aligned RGBA
// offset (validated as such wherever entries are built).
export function reanchorIndex(
  idx: number,
  from: CanvasDims,
  to: CanvasDims,
): number | null {
  const pixel = idx >> 2 // byte offset -> pixel number
  const x = pixel % from.width
  const y = Math.floor(pixel / from.width)
  if (x >= to.width || y >= to.height) {
    return null
  }
  return (y * to.width + x) << 2
}

// Remaps every entry, dropping those whose pixel no longer exists. The result is
// never longer than the input, so it cannot breach the undo stack's byte cap.
export function reanchorEntries(
  entries: PatchEntry[],
  from: CanvasDims,
  to: CanvasDims,
): PatchEntry[] {
  const out: PatchEntry[] = []
  for (const entry of entries) {
    const idx = reanchorIndex(entry.idx, from, to)
    if (idx !== null) {
      out.push({ ...entry, idx })
    }
  }
  return out
}
//#endregion
