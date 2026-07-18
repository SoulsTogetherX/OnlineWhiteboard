//#region Imports
import { useState } from "react"

import PopupBase from "@/components/Popups/PopupBase"
import HsvPicker from "@/components/HsvPicker"
import SwatchRow from "./SwatchRow"

import { clampByte, colorToHex, colorToHex8, hexToColor } from "@/utils/color"
import { colorTypeToString } from "@shared/types/primitive"

import type { ColorType } from "@shared/types/primitive"

import "./styles.css"
//#endregion

//#region Constants
const CHANNEL_NAMES: Record<keyof ColorType, string> = {
  r: "Red",
  g: "Green",
  b: "Blue",
  a: "Alpha",
}
//#endregion

//#region Component
export interface ColorPopupProps {
  isOpen: boolean
  currentColor: ColorType
  onClose: () => void
  onApply: (color: ColorType) => void
  // Palette wiring, owned by App (so recents survive the popup closing and the
  // saved palette can be account-backed).
  recent: string[]
  saved: string[]
  onSaveColor: (hex8: string) => void
  onRemoveSavedColor: (hex8: string) => void
}

export default function ColorPopup({
  isOpen,
  currentColor,
  onClose,
  onApply,
  recent,
  saved,
  onSaveColor,
  onRemoveSavedColor,
}: ColorPopupProps) {
  const [draftColor, setDraftColor] = useState<ColorType>(currentColor)
  const cssPreview = colorTypeToString(draftColor)

  // Re-seed the draft each time the popup opens (PopupBase never unmounts). See
  // RoomPopup for the same during-render pattern.
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
      [component]: clampByte(value),
    }))
  }

  const isSaved = saved.includes(colorToHex8(draftColor))

  return (
    <PopupBase isOpen={isOpen} onClose={onClose} label="Choose a color">
      <div className="color-picker-module">
        <header className="color-picker-header">
          <div
            className="color-preview"
            style={{ backgroundColor: cssPreview }}
            role="img"
            aria-label="Preview of the selected color"
          ></div>
          <div className="color-picker-heading">
            <h2>Color</h2>
            <p>Drag on the square, pick a hue, or type exact values.</p>
          </div>
        </header>

        {/* The visual picker: saturation/value square + hue slider. */}
        <HsvPicker color={draftColor} onChange={setDraftColor} />

        <label className="hex-picker-row">
          <span>Hex</span>
          <input
            name="color-picker"
            type="color"
            value={colorToHex(draftColor)}
            onChange={(ev) => {
              const parsed = hexToColor(ev.target.value)
              if (parsed) {
                setDraftColor({ ...parsed, a: draftColor.a })
              }
            }}
          />
        </label>

        <div className="rgba-grid">
          {(["r", "g", "b", "a"] as const).map((component) => {
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

        <SwatchRow
          label="Saved"
          colors={saved}
          onPick={setDraftColor}
          onRemove={onRemoveSavedColor}
          emptyHint="Save a color to keep it here."
        />
        <SwatchRow
          label="Recent"
          colors={recent}
          onPick={setDraftColor}
          emptyHint="Colors you apply appear here."
        />

        <footer className="color-popup-actions">
          <button
            type="button"
            className="color-save-button"
            onClick={() => onSaveColor(colorToHex8(draftColor))}
            disabled={isSaved}
          >
            {isSaved ? "Saved" : "Save color"}
          </button>
          <span className="color-popup-spacer" />
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
