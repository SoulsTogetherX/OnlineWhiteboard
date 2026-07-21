//#region Canvas Dims
// Canvas dimensions are becoming PER-ROOM (roadmap Phase 4). They used to be
// these two module constants, read directly by every index calculation and
// bounds check in shared/. That is now the wrong shape: the pixel functions take
// a CanvasDims instead, so one server process can hold rooms of different sizes
// and one client can render whatever size a room actually is.
//
// CANVAS_WIDTH/HEIGHT survive only as the DEFAULT a brand-new room is created at,
// and as the value the existing tests and callers pass until per-room dims are
// wired through in the following commits. `canvasBytes(dims)` replaces the old
// derived CANVAS_BYTES constant everywhere a buffer length is needed.
export type CanvasDims = {
  width: number
  height: number
}

// A new room is created at this size. Bigger than the old 120 square, but well
// within MAX so an owner can still grow it.
const DEFAULT_CANVAS_DIMS: CanvasDims = {
  width: 256,
  height: 256,
}

// The hard bounds a room may be resized within. Each is an anti-abuse limit as
// much as a product choice:
//   - MAX bounds the in-memory buffer (512^2 * 4 = 1 MiB per room) AND the
//     worst-case patch (a full-canvas undo is one entry per pixel), which is
//     what sets the socket maxPayload. Raising it costs memory and loosens that
//     ceiling; see backend/src/server.ts.
//   - MIN keeps a canvas from being degenerate (a 1x1 board is not a board) and
//     stops a resize request asking for zero or negative dimensions.
const MAX_CANVAS_DIMENSION = 512
const MIN_CANVAS_DIMENSION = 16

// The dimensions the SOCKET ENVELOPE validates coordinates against, before the
// room's actual (possibly smaller) size is known. Its only job there is to stop
// the catastrophic case — a coordinate like 1e9 that spins Bresenham forever —
// so it uses the largest a canvas may ever be. The fan-in point re-validates
// against the room's real dims.
const MAX_CANVAS_DIMS: CanvasDims = {
  width: MAX_CANVAS_DIMENSION,
  height: MAX_CANVAS_DIMENSION,
}

// RGBA, so four bytes a pixel. The single place that knowledge lives now that it
// is no longer baked into a `<< 2` on a module constant.
function canvasBytes(dims: CanvasDims): number {
  return dims.width * dims.height * 4
}

// Whether a requested size is a legal canvas: whole numbers, both within
// [MIN, MAX]. The one gate the resize handler and its validation share, so the
// server and the client agree on exactly what is resizable.
function isValidCanvasDims(value: unknown): value is CanvasDims {
  if (!value || typeof value !== "object") {
    return false
  }
  const dims = value as Partial<CanvasDims>
  return (
    Number.isInteger(dims.width) &&
    Number.isInteger(dims.height) &&
    (dims.width as number) >= MIN_CANVAS_DIMENSION &&
    (dims.width as number) <= MAX_CANVAS_DIMENSION &&
    (dims.height as number) >= MIN_CANVAS_DIMENSION &&
    (dims.height as number) <= MAX_CANVAS_DIMENSION
  )
}
//#endregion

//#region Color
const DEFAULT_COLOR = { r: 0, b: 0, g: 0, a: 0 }
//#endregion

//#region Brush
// Stroke size is the brush DIAMETER in canvas pixels. 1 is a single pixel (the
// original behaviour); larger values stamp a filled disc of that diameter along
// the stroke. Capped so a hostile client can't ask for a brush the size of the
// canvas and make one instruction paint the whole buffer.
const DEFAULT_STROKE_SIZE = 1
const MAX_STROKE_SIZE = 32
//#endregion

//#region Spray
// The spray can scatters `density` pixels within `radius` of the pointer per
// puff. Both are capped so a crafted instruction can't ask for a huge radius or
// a thousand pixels per puff and turn one message into a fill.
const MAX_SPRAY_RADIUS = 40
const MAX_SPRAY_DENSITY = 64
//#endregion

//#region Patch
// The most entries a single undo/redo patch can legitimately carry: one per
// pixel on the canvas. A patch is a compare-and-swap list, and touching the same
// pixel twice in one patch is meaningless, so anything beyond this is either a
// broken client or a hostile one.
//
// This is the GLOBAL ceiling — one entry per pixel of the largest canvas any
// room may ever be — used by the patch decoder as an allocation guard before the
// room's dimensions are known. Per-room validation (isValidDrawInstruction)
// tightens it to the actual canvas area. It scales with the max canvas so a
// legitimate full-canvas undo on the biggest allowed board still fits.
//
// Without this bound the entries array was limited only by the WebSocket frame
// size — which defaulted to 100 MiB — so one message could hand the server a
// million objects to parse and iterate. Same class of hazard as an unbounded
// coordinate: bounded per-item validation is worthless if the LIST is unbounded.
const MAX_PATCH_ENTRIES = MAX_CANVAS_DIMENSION * MAX_CANVAS_DIMENSION
//#endregion

//#region Exports
export {
  DEFAULT_CANVAS_DIMS,
  MAX_CANVAS_DIMS,
  MAX_CANVAS_DIMENSION,
  MIN_CANVAS_DIMENSION,
  canvasBytes,
  isValidCanvasDims,
  DEFAULT_COLOR,
  DEFAULT_STROKE_SIZE,
  MAX_STROKE_SIZE,
  MAX_SPRAY_RADIUS,
  MAX_SPRAY_DENSITY,
  MAX_PATCH_ENTRIES,
}
//#endregion
