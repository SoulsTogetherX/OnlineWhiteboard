//#region Imports
import { useEffect, useMemo, useState } from "react"

import PopupBase from "@/components/Popups/PopupBase"

import { colorTypeToString } from "@shared/types/primitive"
import type { ColorType } from "@shared/types/primitive"

import "./styles.css"
//#endregion

//#region Helper Methods
function clampColorValue(value: number): number {
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
  const cssPreview = useMemo(() => colorTypeToString(draftColor), [draftColor])

  useEffect(() => {
    if (isOpen) {
      setDraftColor(currentColor)
    }
  }, [currentColor, isOpen])

  const setComponent = (component: keyof ColorType, value: number) => {
    setDraftColor((current) => ({
      ...current,
      [component]: clampColorValue(value),
    }))
  }

  return (
    <PopupBase isOpen={isOpen} onClose={onClose}>
      <div className="color-picker-module">
        <header className="color-picker-header">
          <div>
            <p>RGBA values are saved for this browser session.</p>
          </div>
          <div
            className="color-preview"
            style={{ backgroundColor: cssPreview }}
          ></div>
        </header>

        <label className="hex-picker-row">
          <span>Color</span>
          <input
            type="color"
            value={colorToHex(draftColor)}
            onChange={(ev) =>
              setDraftColor(hexToColor(ev.target.value, draftColor.a))
            }
          />
        </label>

        <div className="rgba-grid">
          {(["r", "g", "b", "a"] as const).map((component) => (
            <label className="rgba-control" key={component}>
              <span>{component.toUpperCase()}</span>
              <input
                type="range"
                min="0"
                max="255"
                value={draftColor[component]}
                onChange={(ev) =>
                  setComponent(component, Number(ev.target.value))
                }
              />
              <input
                type="number"
                min="0"
                max="255"
                value={draftColor[component]}
                onChange={(ev) =>
                  setComponent(component, Number(ev.target.value))
                }
              />
            </label>
          ))}
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
