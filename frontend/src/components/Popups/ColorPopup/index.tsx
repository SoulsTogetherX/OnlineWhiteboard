//#region Imports
import { useState } from "react"

import PopupBase from "@/components/Popups/PopupBase"

import { colorTypeToString } from "@shared/types/primitive"
import type { ColorType } from "@shared/types/primitive"

import "./styles.css"
//#endregion

//#region Constants
// Spelled-out names for screen readers. "R" reads as the letter R, which tells
// a non-sighted user nothing about what the control does.
const CHANNEL_NAMES: Record<keyof ColorType, string> = {
  r: "Red",
  g: "Green",
  b: "Blue",
  a: "Alpha",
}
//#endregion

//#region Helper Methods
function clampColorValue(value: number): number {
  // Math.round(NaN) is NaN, and every comparison against NaN is false — so
  // without this guard a NaN would sail through both clamps and land in the
  // palette as NaN, painting garbage.
  if (!Number.isFinite(value)) {
    return 0
  }
  return Math.max(0, Math.min(255, Math.round(value)))
}

function componentToHex(value: number): string {
  return clampColorValue(value).toString(16).padStart(2, "0")
}

function colorToHex(color: ColorType): string {
  return `#${componentToHex(color.r)}${componentToHex(color.g)}${componentToHex(
    color.b,
  )}`
}

function hexToColor(hex: string, alpha: number): ColorType {
  const cleanHex = hex.replace("#", "")
  return {
    r: parseInt(cleanHex.slice(0, 2), 16),
    g: parseInt(cleanHex.slice(2, 4), 16),
    b: parseInt(cleanHex.slice(4, 6), 16),
    a: alpha,
  }
}
//#endregion

//#region Component
export interface ColorPopupProps {
  isOpen: boolean
  currentColor: ColorType
  onClose: () => void
  onApply: (color: ColorType) => void
}

export default function ColorPopup({
  isOpen,
  currentColor,
  onClose,
  onApply,
}: ColorPopupProps) {
  const [draftColor, setDraftColor] = useState<ColorType>(currentColor)
  const cssPreview = colorTypeToString(draftColor)

  // Re-seed the draft each time the popup opens, so it always reflects the
  // swatch you actually clicked and discards any cancelled edit. Needed because
  // PopupBase only toggles a class — it never unmounts its children, so the
  // useState initializer above runs exactly once, at App mount.
  //
  // Adjusted DURING RENDER rather than in an effect: React discards this render
  // and re-runs with the new state before painting, so the wrong color is never
  // shown. See RoomPopup for the same pattern.
  const [wasOpen, setWasOpen] = useState<boolean>(isOpen)
  if (isOpen !== wasOpen) {
    setWasOpen(isOpen)
    if (isOpen) {
      setDraftColor(currentColor)
    }
  }

  const setComponent = (component: keyof ColorType, value: number) => {
    setDraftColor((current) => ({
      ...current,
      [component]: clampColorValue(value),
    }))
  }

  return (
    <PopupBase isOpen={isOpen} onClose={onClose} label="Choose a color">
      <div className="color-picker-module">
        <header className="color-picker-header">
          <p>RGBA values are saved for this browser session.</p>
          <div
            className="color-preview"
            style={{ backgroundColor: cssPreview }}
            // A bare styled div is invisible to assistive tech; without a role
            // and label there was no way to know a preview existed at all.
            role="img"
            aria-label="Preview of the selected color"
          ></div>
        </header>

        <label className="hex-picker-row">
          <span>Color</span>
          <input
            name="color-picker"
            type="color"
            value={colorToHex(draftColor)}
            onChange={(ev) =>
              setDraftColor(hexToColor(ev.target.value, draftColor.a))
            }
          />
        </label>

        <div className="rgba-grid">
          {(["r", "g", "b", "a"] as const).map((component) => {
            // A <label> associates with only its FIRST labelable descendant.
            // This used to be one <label> wrapping BOTH the slider and the
            // number input, so "R"/"G"/"B"/"A" named the slider and the number
            // field was left with no accessible name at all. Naming each input
            // explicitly fixes that, and lets the two carry distinct names.
            const name = CHANNEL_NAMES[component]
            return (
              <div className="rgba-control" key={component}>
                <span aria-hidden="true">{component.toUpperCase()}</span>
                <input
                  name={`${component}-hue-amount-slider`}
                  type="range"
                  min="0"
                  max="255"
                  value={draftColor[component]}
                  aria-label={`${name} slider`}
                  onChange={(ev) =>
                    setComponent(component, Number(ev.target.value))
                  }
                />
                <input
                  name={`${component}-hue-amount-numerical`}
                  type="number"
                  min="0"
                  max="255"
                  value={draftColor[component]}
                  aria-label={`${name} value`}
                  onChange={(ev) =>
                    setComponent(component, Number(ev.target.value))
                  }
                />
              </div>
            )
          })}
        </div>

        <footer className="color-popup-actions">
          <button type="button" onClick={onClose}>
            Cancel
          </button>
          <button type="button" onClick={() => onApply(draftColor)}>
            Apply
          </button>
        </footer>
      </div>
    </PopupBase>
  )
}
//#endregion
