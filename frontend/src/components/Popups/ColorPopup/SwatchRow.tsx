//#region Imports
import { hexToColor } from "@/utils/color"

import type { ColorType } from "@shared/types/primitive"
//#endregion

//#region Component
export interface SwatchRowProps {
  label: string
  colors: string[] // "#rrggbbaa" strings
  onPick: (color: ColorType) => void
  // When provided, each swatch gets a small remove button (used for the saved
  // palette; recents aren't removable).
  onRemove?: (hex8: string) => void
  emptyHint: string
}

// A labelled strip of colour chips. Clicking a chip selects it; the optional
// remove button deletes it from a palette. The chip background is the
// "#rrggbbaa" string directly — 8-digit hex is a valid CSS colour, alpha and all.
export default function SwatchRow({
  label,
  colors,
  onPick,
  onRemove,
  emptyHint,
}: SwatchRowProps) {
  return (
    <div className="swatch-row">
      <span className="swatch-row-label">{label}</span>
      {colors.length === 0 ? (
        <span className="swatch-row-empty">{emptyHint}</span>
      ) : (
        <ul className="swatch-list">
          {colors.map((hex8) => {
            const color = hexToColor(hex8)
            if (!color) {
              return null
            }
            return (
              <li className="swatch-cell" key={hex8}>
                <button
                  type="button"
                  className="swatch-chip"
                  style={{ backgroundColor: hex8 }}
                  aria-label={`Use color ${hex8}`}
                  onClick={() => onPick(color)}
                />
                {onRemove && (
                  <button
                    type="button"
                    className="swatch-remove"
                    aria-label={`Remove saved color ${hex8}`}
                    onClick={() => onRemove(hex8)}
                  >
                    ×
                  </button>
                )}
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
//#endregion
