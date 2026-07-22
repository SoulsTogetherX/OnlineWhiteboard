// Named .test.tsx despite testing no component: the vitest projects split by
// extension, and this needs real DOM events and element liveness, so it belongs
// in the jsdom project (see vite.config.ts).

import { beforeEach, describe, expect, it, vi } from "vitest"

import {
  installRecentSliderTracking,
  nudgeSlider,
  recentSlider,
  resetRecentSlider,
} from "./recentSlider"

function addSlider(attrs: Partial<HTMLInputElement> = {}): HTMLInputElement {
  const slider = document.createElement("input")
  slider.type = "range"
  slider.min = "1"
  slider.max = "32"
  slider.step = "1"
  slider.value = "5"
  Object.assign(slider, attrs)
  document.body.appendChild(slider)
  return slider
}

beforeEach(() => {
  document.body.innerHTML = ""
  resetRecentSlider()
  installRecentSliderTracking()
})

describe("recentSlider", () => {
  it("has nothing to offer before anything is touched", () => {
    addSlider()
    expect(recentSlider()).toBeNull()
  })

  it("remembers a slider that was focused", () => {
    const slider = addSlider()
    slider.dispatchEvent(new FocusEvent("focusin", { bubbles: true }))

    expect(recentSlider()).toBe(slider)
  })

  it("keeps it after focus moves away", () => {
    // The whole point: you size a brush, click the canvas to try it (focus
    // gone), and the wheel must still adjust the same slider. A focus-based rule
    // worked exactly once.
    const slider = addSlider()
    slider.dispatchEvent(new FocusEvent("focusin", { bubbles: true }))

    const elsewhere = document.createElement("button")
    document.body.appendChild(elsewhere)
    elsewhere.dispatchEvent(new FocusEvent("focusin", { bubbles: true }))

    expect(recentSlider()).toBe(slider)
  })

  it("tracks the most recent of several", () => {
    const first = addSlider()
    const second = addSlider()
    first.dispatchEvent(new FocusEvent("focusin", { bubbles: true }))
    second.dispatchEvent(new Event("input", { bubbles: true }))

    expect(recentSlider()).toBe(second)
  })

  it("ignores inputs that are not sliders", () => {
    const text = document.createElement("input")
    text.type = "text"
    document.body.appendChild(text)
    text.dispatchEvent(new FocusEvent("focusin", { bubbles: true }))

    expect(recentSlider()).toBeNull()
  })

  it("forgets a slider whose panel has unmounted", () => {
    // Switching tools swaps the panel out. Nudging a detached node would change
    // nothing while looking like it worked.
    const slider = addSlider()
    slider.dispatchEvent(new FocusEvent("focusin", { bubbles: true }))
    slider.remove()

    expect(recentSlider()).toBeNull()
  })

  it("forgets a slider that has become disabled", () => {
    const slider = addSlider()
    slider.dispatchEvent(new FocusEvent("focusin", { bubbles: true }))
    slider.disabled = true

    expect(recentSlider()).toBeNull()
  })

  // The regression that made the feature look broken on first use: tracking was
  // installed lazily by the first read, so the interaction it needed to have
  // seen had already happened. Installing must be what starts it, not reading.
  it("is the install that starts tracking, not the first read", () => {
    resetRecentSlider()
    const slider = addSlider()
    slider.dispatchEvent(new FocusEvent("focusin", { bubbles: true }))

    // Listeners were installed in beforeEach, so this interaction — which
    // happened before any recentSlider() call — was still seen.
    expect(recentSlider()).toBe(slider)
  })
})

describe("nudgeSlider", () => {
  it("steps up and down by the input's own step", () => {
    const slider = addSlider()

    nudgeSlider(slider, 1)
    expect(slider.value).toBe("6")

    nudgeSlider(slider, -1)
    expect(slider.value).toBe("5")
  })

  it("respects min and max rather than running past them", () => {
    const slider = addSlider({ value: "32" } as Partial<HTMLInputElement>)
    nudgeSlider(slider, 1)
    expect(slider.value).toBe("32")

    slider.value = "1"
    nudgeSlider(slider, -1)
    expect(slider.value).toBe("1")
  })

  it("fires an input event so React's onChange runs", () => {
    // React tracks the DOM value it last wrote and only calls onChange when an
    // input event reports something different — setting .value alone is silent.
    const slider = addSlider()
    const onInput = vi.fn()
    slider.addEventListener("input", onInput)

    nudgeSlider(slider, 1)

    expect(onInput).toHaveBeenCalledTimes(1)
    expect(onInput.mock.calls[0][0].bubbles).toBe(true)
  })
})
