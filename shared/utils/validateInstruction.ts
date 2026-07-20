//#region Imports
import {
  CANVAS_BYTES,
  CANVAS_HEIGHT,
  CANVAS_WIDTH,
  MAX_PATCH_ENTRIES,
  MAX_SPRAY_DENSITY,
  MAX_SPRAY_RADIUS,
  MAX_STROKE_SIZE,
} from "../constants/canvas"

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

// Brush diameter. Optional (absent means 1); if present it must be an integer
// in [1, MAX_STROKE_SIZE]. The upper bound is the important half — it stops a
// crafted instruction from asking for a canvas-sized brush so one stroke paints
// the entire buffer (a CPU/undo-memory abuse, the same class of hazard the
// coordinate bounds close for lines).
function isValidSize(value: unknown): boolean {
  if (value === undefined) {
    return true
  }
  return (
    typeof value === "number" &&
    Number.isInteger(value) &&
    value >= 1 &&
    value <= MAX_STROKE_SIZE
  )
}

// Bounded positive integer, used for the spray radius/density. The upper bound
// is the abuse guard — same reasoning as the stroke-size cap.
function isBoundedInt(value: unknown, min: number, max: number): boolean {
  return (
    typeof value === "number" &&
    Number.isInteger(value) &&
    value >= min &&
    value <= max
  )
}

// The spray seed is any 32-bit unsigned integer (it just drives the PRNG); the
// only requirement is that it's a finite non-negative integer in range.
function isValidSeed(value: unknown): boolean {
  return isBoundedInt(value, 0, 0xffffffff)
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
  if (!isValidSize((candidate as { size?: unknown }).size)) {
    return false
  }

  switch (candidate.type) {
    case "pencil":
    case "eraser":
      return isValidVec(candidate.prevPos) && isValidVec(candidate.nextPos)
    case "bucket":
      return isValidVec(candidate.pos)
    case "spray": {
      const spray = candidate as {
        pos?: unknown
        radius?: unknown
        density?: unknown
        seed?: unknown
      }
      return (
        isValidVec(spray.pos) &&
        isBoundedInt(spray.radius, 1, MAX_SPRAY_RADIUS) &&
        isBoundedInt(spray.density, 1, MAX_SPRAY_DENSITY) &&
        isValidSeed(spray.seed)
      )
    }
    case "patch":
      // The LENGTH check is as important as the per-entry check. Validating each
      // entry bounds what one entry can do; only this bounds how many there are.
      return (
        Array.isArray(candidate.entries) &&
        candidate.entries.length <= MAX_PATCH_ENTRIES &&
        candidate.entries.every(isValidPatchEntry)
      )
    case "clear":
      // No fields beyond the base (already checked above). The GATE on clear is
      // authorisation, not shape: the server refuses a client-originated clear
      // and only ever applies one it generated for the owner — so this returning
      // true is safe, and lets a clear replay from the event log like anything else.
      return true
    default:
      return false
  }
}
//#endregion
