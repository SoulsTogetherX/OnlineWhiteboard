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

const CANVAS_WIDTH = 120
const CANVAS_HEIGHT = 120

// The dimensions a new room is created at when nothing else specifies. Still 120
// square for now; the larger default lands with the per-room wiring.
const DEFAULT_CANVAS_DIMS: CanvasDims = {
  width: CANVAS_WIDTH,
  height: CANVAS_HEIGHT,
}

// RGBA, so four bytes a pixel. The single place that knowledge lives now that it
// is no longer baked into a `<< 2` on a module constant.
function canvasBytes(dims: CanvasDims): number {
  return dims.width * dims.height * 4
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
const MAX_PATCH_ENTRIES = CANVAS_WIDTH * CANVAS_HEIGHT
//#endregion

//#region Exports
export {
  CANVAS_WIDTH,
  CANVAS_HEIGHT,
  DEFAULT_CANVAS_DIMS,
  canvasBytes,
  DEFAULT_COLOR,
  DEFAULT_STROKE_SIZE,
  MAX_STROKE_SIZE,
  MAX_SPRAY_RADIUS,
  MAX_SPRAY_DENSITY,
  MAX_PATCH_ENTRIES,
}
//#endregion
