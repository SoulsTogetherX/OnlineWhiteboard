//#region Canvas Dims
const CANVAS_WIDTH = 120
const CANVAS_HEIGHT = 120
const CANVAS_BYTES = (CANVAS_WIDTH * CANVAS_HEIGHT) << 2
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
  CANVAS_BYTES,
  DEFAULT_COLOR,
  DEFAULT_STROKE_SIZE,
  MAX_STROKE_SIZE,
  MAX_SPRAY_RADIUS,
  MAX_SPRAY_DENSITY,
  MAX_PATCH_ENTRIES,
}
//#endregion
