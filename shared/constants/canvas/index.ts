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

//#region Exports
export {
  CANVAS_WIDTH,
  CANVAS_HEIGHT,
  CANVAS_BYTES,
  DEFAULT_COLOR,
  DEFAULT_STROKE_SIZE,
  MAX_STROKE_SIZE,
}
//#endregion
