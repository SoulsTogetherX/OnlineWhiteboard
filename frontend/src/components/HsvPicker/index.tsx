//#region Imports
import { useRef, useState, type KeyboardEvent } from "react"

import { hsvToRgb, rgbToHsv } from "@/utils/color"

import type { ColorType } from "@shared/types/primitive"

import "./styles.css"
//#endregion

//#region Helpers
function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value))
}
function clampHue(value: number): number {
  return Math.max(0, Math.min(360, value))
}

// Keyboard step sizes. Shift gives a coarse step so crossing the full range
// doesn't take a hundred key presses, which is the usual reason people abandon
// a keyboard-driven slider.
const SV_STEP = 0.01
const SV_STEP_COARSE = 0.1
const HUE_STEP = 1
const HUE_STEP_COARSE = 10
//#endregion

//#region Component
export interface HsvPickerProps {
  color: ColorType
  onChange: (color: ColorType) => void
}

// The visual picker: a saturation/value square plus a hue slider. Alpha is left
// to the caller's alpha control — this component only touches r/g/b.
export default function HsvPicker({ color, onChange }: HsvPickerProps) {
  // Hue is kept in local state, NOT derived from `color` every render. At pure
  // black or a greyscale colour the hue is mathematically undefined (s or v is
  // 0), so deriving it would make the hue slider jump to red the moment you drag
  // value to the bottom. Local state preserves the hue the user chose.
  const [hue, setHue] = useState<number>(
    () => rgbToHsv(color.r, color.g, color.b).h,
  )

  // Adopt the hue when the colour changes from OUTSIDE (RGBA inputs, a saved
  // swatch, the eyedropper) to one that actually has a hue. Done during render,
  // not in an effect: React re-renders with the corrected hue before painting,
  // so there's no flash and no cascading-render lint concern. Tracking the last
  // rgb we reconciled is what stops this from looping.
  const rgbKey = `${color.r},${color.g},${color.b}`
  const [lastRgbKey, setLastRgbKey] = useState<string>(rgbKey)
  if (rgbKey !== lastRgbKey) {
    setLastRgbKey(rgbKey)
    const derived = rgbToHsv(color.r, color.g, color.b)
    if (derived.s > 0 && derived.v > 0) {
      setHue(derived.h)
    }
  }

  const { s, v } = rgbToHsv(color.r, color.g, color.b)

  const emit = (nextHue: number, nextS: number, nextV: number) => {
    const rgb = hsvToRgb(nextHue, nextS, nextV)
    onChange({ ...rgb, a: color.a })
  }

  // --- Saturation / Value square drag ---
  const svRef = useRef<HTMLDivElement>(null)
  const svDragging = useRef(false)
  const pickSv = (clientX: number, clientY: number) => {
    const el = svRef.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    const nextS = clamp01((clientX - rect.left) / rect.width)
    const nextV = 1 - clamp01((clientY - rect.top) / rect.height)
    emit(hue, nextS, nextV)
  }

  // --- Hue slider drag ---
  const hueRef = useRef<HTMLDivElement>(null)
  const hueDragging = useRef(false)
  const pickHue = (clientX: number) => {
    const el = hueRef.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    const nextHue = clamp01((clientX - rect.left) / rect.width) * 360
    setHue(nextHue)
    emit(nextHue, s, v)
  }

  // --- Keyboard ---
  // Both controls declare role="slider" and tabIndex={0}, which PROMISES
  // keyboard operation. Without these handlers that promise was false: the
  // controls took focus and then ignored every key. A focusable control that
  // does nothing is worse for assistive-tech users than one that was never
  // focusable, because the ARIA role advertises an interaction that isn't
  // there. Key mapping follows the WAI-ARIA slider pattern.
  const onSvKeyDown = (ev: KeyboardEvent<HTMLDivElement>) => {
    const step = ev.shiftKey ? SV_STEP_COARSE : SV_STEP
    let nextS = s
    let nextV = v

    switch (ev.key) {
      case "ArrowLeft":
        nextS = clamp01(s - step)
        break
      case "ArrowRight":
        nextS = clamp01(s + step)
        break
      case "ArrowUp":
        nextV = clamp01(v + step)
        break
      case "ArrowDown":
        nextV = clamp01(v - step)
        break
      case "Home":
        nextS = 0
        break
      case "End":
        nextS = 1
        break
      default:
        return
    }

    // Only after a key we actually handled, so Tab and shortcuts still work.
    ev.preventDefault()
    emit(hue, nextS, nextV)
  }

  const onHueKeyDown = (ev: KeyboardEvent<HTMLDivElement>) => {
    const step = ev.shiftKey ? HUE_STEP_COARSE : HUE_STEP
    // No initialiser: every branch below assigns it and `default` returns, so
    // seeding it with `hue` would be a value nothing reads.
    let nextHue: number

    switch (ev.key) {
      case "ArrowLeft":
      case "ArrowDown":
        nextHue = clampHue(hue - step)
        break
      case "ArrowRight":
      case "ArrowUp":
        nextHue = clampHue(hue + step)
        break
      case "Home":
        nextHue = 0
        break
      case "End":
        nextHue = 360
        break
      default:
        return
    }

    ev.preventDefault()
    setHue(nextHue)
    emit(nextHue, s, v)
  }

  return (
    <div className="hsv-picker">
      <div
        ref={svRef}
        className="hsv-square"
        style={{ ["--hue" as string]: hue }}
        role="slider"
        aria-label="Saturation and brightness"
        aria-valuetext={`saturation ${Math.round(s * 100)}%, brightness ${Math.round(v * 100)}%`}
        tabIndex={0}
        onKeyDown={onSvKeyDown}
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId)
          svDragging.current = true
          pickSv(e.clientX, e.clientY)
        }}
        onPointerMove={(e) => {
          if (svDragging.current) pickSv(e.clientX, e.clientY)
        }}
        onPointerUp={() => {
          svDragging.current = false
        }}
      >
        <span
          className="hsv-square-thumb"
          style={{ left: `${s * 100}%`, top: `${(1 - v) * 100}%` }}
        />
      </div>

      <div
        ref={hueRef}
        className="hsv-hue"
        role="slider"
        aria-label="Hue"
        aria-valuemin={0}
        aria-valuemax={360}
        aria-valuenow={Math.round(hue)}
        tabIndex={0}
        onKeyDown={onHueKeyDown}
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId)
          hueDragging.current = true
          pickHue(e.clientX)
        }}
        onPointerMove={(e) => {
          if (hueDragging.current) pickHue(e.clientX)
        }}
        onPointerUp={() => {
          hueDragging.current = false
        }}
      >
        <span className="hsv-hue-thumb" style={{ left: `${(hue / 360) * 100}%` }} />
      </div>
    </div>
  )
}
//#endregion
