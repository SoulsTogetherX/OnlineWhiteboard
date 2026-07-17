//#region Imports
import { CANVAS_BYTES, CANVAS_HEIGHT, CANVAS_WIDTH } from "../constants/canvas"

import type { DrawInstruction, PatchEntry } from "../types/drawProtocol"
import type { ColorType, Vec } from "../types/primitive"
//#endregion

//#region Why this exists
// The server applies whatever arrives on the socket. `RoomManager.parseMessage`
// does `JSON.parse(...) as ClientSocketMessage` — and an `as` cast is a
// compile-time assertion, not a runtime check. Nothing between the network and
// the pixel writers verified a single field.
//
// The worst case was not corruption but a hang: Bresenham in setPixelLine is a
// `while (true)` that steps one pixel at a time, so an instruction claiming
// nextPos [1e9, 1e9] spins for a billion iterations. Node is single-threaded,
// so that one message freezes the event loop for EVERY room and EVERY client —
// and being synchronous, nothing can interrupt it.
//
// These guards run on both sides (the client validates instructions it receives
// too), which is why they live in shared/.
//#endregion

//#region Primitive Guards
function isByte(value: unknown): boolean {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= 255
}

export function isValidColor(value: unknown): value is ColorType {
  if (!value || typeof value !== "object") {
    return false
  }
  const color = value as Partial<ColorType>
  return isByte(color.r) && isByte(color.g) && isByte(color.b) && isByte(color.a)
}

// Number.isInteger rejects NaN, Infinity and fractions in one go — all three
// would otherwise slip past a naive `x >= 0 && x < CANVAS_WIDTH` check
// (NaN comparisons are false, so NaN fails, but 1.5 and -0.0 would not).
export function isValidVec(value: unknown): value is Vec {
  if (!Array.isArray(value) || value.length !== 2) {
    return false
  }
  const [x, y] = value as [unknown, unknown]
  return (
    Number.isInteger(x) &&
    Number.isInteger(y) &&
    (x as number) >= 0 &&
    (x as number) < CANVAS_WIDTH &&
    (y as number) >= 0 &&
    (y as number) < CANVAS_HEIGHT
  )
}

// A patch index is a raw byte offset into the RGBA buffer, so it must be in
// range AND 4-byte aligned — an unaligned index would smear one color across
// two pixels' channels.
export function isValidPatchIdx(value: unknown): boolean {
  return (
    typeof value === "number" &&
    Number.isInteger(value) &&
    value >= 0 &&
    value < CANVAS_BYTES &&
    (value & 3) === 0
  )
}

function isValidPatchEntry(value: unknown): value is PatchEntry {
  if (!value || typeof value !== "object") {
    return false
  }
  const entry = value as Partial<PatchEntry>
  return (
    isValidPatchIdx(entry.idx) && isValidColor(entry.from) && isValidColor(entry.to)
  )
}
//#endregion

//#region Instruction Guard
// Returns false for anything that must not reach the pixel writers. Callers
// treat false as "drop it": no canvas mutation, no revision bump, no broadcast.
//
// A patch is rejected wholesale if ANY entry is malformed rather than filtering
// the bad ones out — a partially-understood patch is a sign of a broken or
// hostile client, and silently applying half of it would leave the sender's
// undo stack disagreeing with the canvas.
export function isValidDrawInstruction(inst: unknown): inst is DrawInstruction {
  if (!inst || typeof inst !== "object") {
    return false
  }

  const candidate = inst as Partial<DrawInstruction>

  // `color` is optional on BaseInstruction (handlers fall back to
  // DEFAULT_COLOR), but if present it has to be well-formed.
  if (candidate.color !== undefined && !isValidColor(candidate.color)) {
    return false
  }

  switch (candidate.type) {
    case "pencil":
    case "eraser":
      return isValidVec(candidate.prevPos) && isValidVec(candidate.nextPos)
    case "bucket":
      return isValidVec(candidate.pos)
    case "patch":
      return (
        Array.isArray(candidate.entries) && candidate.entries.every(isValidPatchEntry)
      )
    default:
      return false
  }
}
//#endregion
