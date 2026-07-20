//#region Why this exists
// The 100 ms perceptual guarantee (CLAUDE.md §16): a pixel you just painted stays
// visible for a beat even if a collaborator paints over the same spot at the same
// moment. Your input must never *feel* eaten — while the final canvas still
// converges byte-identically for everyone.
//
// The mechanism is a display-only overlay, and the word "display-only" is the
// whole safety argument. Remote instructions apply to the authoritative ImageData
// immediately and unconditionally, exactly as before, so that buffer is always
// the server's last-writer-wins truth and never diverges. Separately, the pixels
// THIS client just painted are remembered here with an expiry, and composited on
// top at paint time. The held values are never read back into the buffer, never
// sent, never persisted — they only change what is shown, for 100 ms.
//
// That is what makes this safe where the tempting alternatives are not. Deferring
// the remote write would reorder the apply sequence against the server's;
// CAS-ing the local paint against the buffer would make undo see a different
// history. Both change what CONVERGES. This changes only what is briefly SHOWN.
//
// It is DOM-free on purpose: the pixel overlay is a pure function over a byte
// buffer, unit-tested without a canvas. The thin glue that reads the live
// ImageData and blits (getCanvasState + putImageData) lives in useRoomConnection,
// which also owns the one timer that reveals the converged state when a hold
// expires with no further traffic to trigger a repaint.
//#endregion

//#region Imports
import { CANVAS_BYTES } from "@shared/constants/canvas"

import type { PatchEntry } from "@shared/types/drawProtocol"
import type { ColorType } from "@shared/types/primitive"
//#endregion

//#region Constants
// Perceptual, not functional. Long enough that a colliding remote instruction
// cannot make your own stroke visibly flicker out from under you; short enough
// that the true converged pixel appears well within the ~100 ms that reads as
// "instant". The whole design rests on this being display-only, so the exact
// value is a UX choice, not a correctness one.
export const HOLD_DURATION_MS = 100
//#endregion

//#region Hold store
type HeldPixel = ColorType & { expiresAt: number }

// Keyed by BYTE index into the RGBA buffer (the same idx a PatchEntry carries),
// so a later paint at the same pixel overwrites the earlier hold rather than
// stacking. One entry per held pixel, bounded by the canvas size.
const holds = new Map<number, HeldPixel>()

// Records pixels this client just painted, to be shown on top of any remote
// overwrite until they expire. `entries` are the recorded writes of a local
// stroke or undo — idx plus the colour it was painted TO.
export function holdLocalPixels(entries: PatchEntry[], now: number): void {
  const expiresAt = now + HOLD_DURATION_MS
  for (const entry of entries) {
    holds.set(entry.idx, {
      r: entry.to.r,
      g: entry.to.g,
      b: entry.to.b,
      a: entry.to.a,
      expiresAt,
    })
  }
}

// Drops every hold that has reached its expiry. Called by overlayHolds before it
// reads them, so expired pixels stop being shown the next time the canvas is
// painted — which is what reveals the converged state.
function pruneExpired(now: number): void {
  for (const [idx, held] of holds) {
    if (held.expiresAt <= now) {
      holds.delete(idx)
    }
  }
}

// The pure core. Returns a COPY of `base` with every still-live held pixel
// stamped on top, or null when nothing is held — in which case the caller should
// blit `base` unchanged, so the no-hold path (the overwhelming common case) pays
// no copy. `base` is never mutated: the authoritative buffer must stay the
// server's truth.
export function overlayHolds(
  base: Uint8ClampedArray,
  now: number,
): Uint8ClampedArray<ArrayBuffer> | null {
  pruneExpired(now)
  if (holds.size === 0) {
    return null
  }

  // Allocate-then-set (not `new Uint8ClampedArray(base)`) so the copy is backed
  // by a plain ArrayBuffer — what `new ImageData` requires — rather than
  // inheriting the source's looser ArrayBufferLike type.
  const out = new Uint8ClampedArray(base.length)
  out.set(base)
  for (const [idx, held] of holds) {
    // Guard the write: a hold from a larger canvas must never scribble past the
    // end of a smaller buffer (relevant once Phase 4 makes canvases resizable).
    if (idx + 3 >= out.length) {
      continue
    }
    out[idx] = held.r
    out[idx + 1] = held.g
    out[idx + 2] = held.b
    out[idx + 3] = held.a
  }
  return out
}

// Whether any hold is still live at `now`, so the caller can decide to keep the
// expiry timer running.
export function hasLiveHolds(now: number): boolean {
  pruneExpired(now)
  return holds.size > 0
}

// The latest moment a currently-held pixel needs revealing, so the caller can
// schedule a single repaint for when the last hold expires. null when empty.
export function latestExpiry(): number | null {
  let latest: number | null = null
  for (const held of holds.values()) {
    if (latest === null || held.expiresAt > latest) {
      latest = held.expiresAt
    }
  }
  return latest
}

// Forgets every hold — called when the canvas identity changes out from under
// them (a room switch), so one room's in-flight strokes can never paint onto
// another's canvas.
export function clearHolds(): void {
  holds.clear()
}

// Exposed for the test only: the buffer length a hold index is bounded against.
export const HOLD_BUFFER_BYTES = CANVAS_BYTES
//#endregion
