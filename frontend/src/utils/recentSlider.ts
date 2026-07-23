//#region Why this exists
// The wheel over the canvas adjusts the slider you were last working with.
//
// "Last worked with" rather than "currently focused" is the important part.
// Focus is lost the moment you click the canvas — which is exactly when you want
// to try the brush you just sized and then adjust it again. Tying the wheel to
// focus meant the gesture worked once and then silently stopped, which is worse
// than not having it.
//
// So this tracks the last range input the user actually touched — focused, or
// changed by any means including a previous wheel — and keeps it after focus
// moves away. Shift+wheel is the canvas's zoom (useCanvasMotion), so the two
// gestures never contend.
//#endregion

//#region Tracking
let recent: HTMLInputElement | null = null
let listening = false

function remember(event: Event): void {
  const target = event.target
  if (target instanceof HTMLInputElement && target.type === "range") {
    recent = target
  }
}

// One set of listeners for the whole app, idempotent and never removed. Capture
// phase, so a slider that stops propagation is still seen.
//
// Called when the board MOUNTS, not lazily on first read. Lazily was wrong in a
// way that is easy to miss: nothing asked until the first wheel event, so the
// listeners went on only after it, and the very interaction that should have
// been remembered — touching the slider — happened before anything was watching.
// The first wheel therefore always did nothing.
export function installRecentSliderTracking(): void {
  if (listening || typeof document === "undefined") {
    return
  }
  listening = true
  document.addEventListener("focusin", remember, true)
  document.addEventListener("input", remember, true)
  document.addEventListener("pointerdown", remember, true)
}

// The slider the wheel should drive, or null if there isn't a usable one.
//
// Checks `isConnected` because panels unmount when the tool changes: a remembered
// slider from the spray panel is a detached node once you switch to the pencil,
// and nudging it would update nothing while appearing to work.
export function recentSlider(): HTMLInputElement | null {
  if (!recent || !recent.isConnected || recent.disabled) {
    return null
  }
  return recent
}

// Test seam: lets a test start from a known state rather than whatever a
// previous test left behind.
export function resetRecentSlider(): void {
  recent = null
}
//#endregion

//#region Cycling
// Where the cycleable sliders live. Scoped to the tool panel on purpose: the
// colour picker and the playback scrubber are range inputs too, and cycling into
// one of those would hand the wheel a control that has nothing to do with the
// brush in your hand.
const TOOL_PANEL_SELECTOR = ".drawing-tab"

// The attribute the active slider is marked with, so it can be highlighted
// without relying on focus. Focus is the wrong signal here — the whole point is
// that this works mid-stroke, when the pointer owns the interaction and focus is
// wherever it happened to be.
export const WHEEL_TARGET_ATTR = "data-wheel-target"

function cycleableSliders(): HTMLInputElement[] {
  if (typeof document === "undefined") {
    return []
  }
  const panel = document.querySelector(TOOL_PANEL_SELECTOR)
  if (!panel) {
    return []
  }
  return [
    ...panel.querySelectorAll<HTMLInputElement>('input[type="range"]'),
  ].filter((slider) => !slider.disabled)
}

// Re-marks the DOM so exactly one slider carries the attribute. Called after any
// change of target, and after a re-render could have replaced the nodes.
function markTarget(): void {
  for (const slider of cycleableSliders()) {
    if (slider === recent) {
      slider.setAttribute(WHEEL_TARGET_ATTR, "true")
    } else {
      slider.removeAttribute(WHEEL_TARGET_ATTR)
    }
  }
}

// Moves the wheel's target to the next slider in the active tool's panel and
// returns its label, so the caller can say what just happened.
//
// Wraps around, and starts from the first slider when nothing is remembered yet,
// so the shortcut always does something visible rather than silently no-opping
// on a fresh page.
export function cycleRecentSlider(direction: 1 | -1 = 1): string | null {
  const sliders = cycleableSliders()
  if (sliders.length === 0) {
    return null
  }

  const current = recent ? sliders.indexOf(recent) : -1
  // (i + n) % n rather than plain %, because JS's % keeps the sign of the
  // dividend and a bare -1 % n is -1, not n - 1.
  const next =
    current === -1
      ? 0
      : (current + direction + sliders.length) % sliders.length

  recent = sliders[next]
  markTarget()
  return recent.getAttribute("aria-label") ?? recent.id ?? null
}

// Keeps the highlight on the right node after React re-renders a panel, and
// makes sure SOMETHING is targeted whenever the panel has sliders.
//
// Defaulting to the first one matters: without it the wheel did nothing at all
// until you had either touched a slider or pressed the cycle key, which makes a
// documented gesture look broken on arrival. A remembered slider from a panel
// that has since unmounted (switching tools) is dropped first — it is a detached
// node, so nudging it would update nothing while appearing to work.
export function refreshWheelTargetMark(): void {
  if (recent && !recent.isConnected) {
    recent = null
  }
  const sliders = cycleableSliders()
  if ((!recent || !sliders.includes(recent)) && sliders.length > 0) {
    recent = sliders[0]
  }
  markTarget()
}
//#endregion

//#region Stepping
// Steps a slider by one of its own increments and tells React about it.
//
// stepUp/stepDown rather than arithmetic: they already respect the input's step,
// min and max, so the wheel moves the control by exactly what an arrow key would.
// The "input" event is what React's change tracking listens for — it compares the
// DOM value against the last value it wrote, sees a difference, and runs onChange,
// so the controlled state stays the source of truth.
export function nudgeSlider(slider: HTMLInputElement, direction: 1 | -1): void {
  if (direction > 0) {
    slider.stepUp()
  } else {
    slider.stepDown()
  }
  slider.dispatchEvent(new Event("input", { bubbles: true }))
}
//#endregion
