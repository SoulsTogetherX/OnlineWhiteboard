//#region Why this exists
// A stabilizer trades responsiveness for steadiness: the brush chases a lagging
// average of the pointer instead of following it exactly, so hand tremor and the
// jagged steps of a fast mouse come out as a smooth line.
//
// It is applied to the POINTER POSITION, before any drawing happens, which is
// what keeps it purely local. The instructions that go on the wire are built
// from the smoothed positions like any others, so no other client, the server,
// the event log and the replay engine need to know this feature exists — a
// stabilizer implemented downstream, by smoothing the drawn line, would have had
// to be a protocol change.
//#endregion

//#region Constants
// The slider's range. 0 is off; the top end is heavy enough to draw a steady
// curve freehand without the brush feeling disconnected from the pointer.
export const MAX_STABILIZATION = 20
export const DEFAULT_STABILIZATION = 0
//#endregion

//#region Type Defs
// The subset of a PointerEvent the drawing path actually reads: `getPos` uses
// the client coordinates, `getDirectColor` uses the button state to pick primary
// vs secondary. Everything else is left on the original event.
interface PointerSample {
  clientX: number
  clientY: number
  pointerType: string
  button: number
  buttons: number
}

export interface Stabilizer {
  // Starts a gesture at the pointer's true position. A stroke has to begin where
  // you pressed, or every stroke would open with a visible lurch from wherever
  // the previous one left the average.
  begin: (event: PointerEvent) => PointerEvent
  // Advances the average and returns the smoothed position.
  step: (event: PointerEvent) => PointerEvent
}
//#endregion

//#region Implementation
// An exponential moving average. Chosen over a sliding window of the last N
// points because it holds one number instead of a buffer, has no window edge to
// produce a step change at, and maps cleanly onto a single slider:
//
//     alpha = 1 / (1 + strength)
//
// strength 0 gives alpha 1 — the raw pointer, exactly no smoothing. That
// property matters: "off" must be indistinguishable from not having the feature,
// so the default costs nothing and nobody has to trust the maths to draw.
//
// `strengthRef` is a REF read at step time rather than a captured value, so
// moving the slider mid-stroke takes effect on the next pointer move (§13.5).
export function createStabilizer(
  strengthRef: React.RefObject<number>,
): Stabilizer {
  let x = 0
  let y = 0

  // Shadows clientX/clientY on a plain object rather than mutating the event:
  // the real properties are read-only getters, and cloning a PointerEvent just
  // to change two fields is far more machinery than this path needs.
  const sample = (event: PointerEvent, sx: number, sy: number): PointerEvent =>
    ({
      clientX: sx,
      clientY: sy,
      pointerType: event.pointerType,
      button: event.button,
      buttons: event.buttons,
    }) as PointerSample as unknown as PointerEvent

  return {
    begin(event) {
      x = event.clientX
      y = event.clientY
      return event
    },

    step(event) {
      const strength = strengthRef.current ?? 0
      if (strength <= 0) {
        // Off: hand back the original event untouched, so nothing downstream can
        // tell the stabilizer is in the path at all.
        x = event.clientX
        y = event.clientY
        return event
      }

      const alpha = 1 / (1 + strength)
      x += (event.clientX - x) * alpha
      y += (event.clientY - y) * alpha
      return sample(event, x, y)
    },
  }
}
//#endregion
