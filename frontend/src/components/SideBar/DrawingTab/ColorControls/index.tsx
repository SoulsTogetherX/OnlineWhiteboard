//#region Imports
import { useReducer } from "react"

import { colorTypeToString } from "@shared/types/primitive"
import type { ColorPalette } from "@shared/types/primitive"

import "./styles.css"
//#endregion

//#region Component Def
export interface ColorControlsProps {
  // A ref, not a value: the palette is read by the pointer handlers on every
  // draw event (§13.5), so it can't be state. The swatch display therefore
  // re-reads the ref whenever this component re-renders.
  colorPalette: React.RefObject<ColorPalette>
  // Swaps primary/secondary AND persists (useColorPalette). It mutates a ref and
  // triggers no render on its own, so this component forces one after swapping.
  onSwap: () => void
  // Opens the colour picker for the primary (true) or secondary (false) swatch.
  openColorPopup: (primary: boolean) => void
}

// The primary/secondary colour swatches with a swap control. The primary swatch
// sits raised over the secondary (the familiar foreground/background stack).
// Presentational: it opens the picker and requests a swap; the palette lives in
// the ref App owns.
export default function ColorControls({
  colorPalette,
  onSwap,
  openColorPopup,
}: ColorControlsProps) {
  // The palette is a ref, so mutating it (swap) doesn't re-render. Bump a nonce
  // to re-read the ref and reflect the new swatch colours.
  const [, forceRender] = useReducer((count: number) => count + 1, 0)

  // Counts swaps rather than holding a boolean. Used as the animated element's
  // `key`, so React replaces the nodes and the CSS animation restarts from the
  // beginning even if you swap again mid-flight — a boolean would need a timer
  // to clear, and would skip the animation on a fast second click.
  const [swapCount, countSwap] = useReducer((count: number) => count + 1, 0)

  const primary = colorTypeToString(colorPalette.current.primary)
  const secondary = colorTypeToString(colorPalette.current.secondary)

  return (
    <div className="color-controls">
      {/* The swatches animate FROM each other's positions to their own. By the
          time this renders the colours have already exchanged, so each swatch
          travelling home from where the other one was reads as the two colours
          trading places. */}
      <div
        key={swapCount}
        className={swapCount > 0 ? "color-swatches color-swatches-swapping" : "color-swatches"}
      >
        <button
          type="button"
          className="color-swatch color-swatch-secondary"
          style={{ backgroundColor: secondary }}
          aria-label="Change secondary color"
          onClick={() => openColorPopup(false)}
        />
        <button
          type="button"
          className="color-swatch color-swatch-primary"
          style={{ backgroundColor: primary }}
          aria-label="Change primary color"
          onClick={() => openColorPopup(true)}
        />
      </div>

      <button
        type="button"
        className="color-swap"
        aria-label="Swap primary and secondary colors"
        onClick={() => {
          onSwap()
          countSwap()
          forceRender()
        }}
      >
        <svg viewBox="0 0 16 16" aria-hidden="true">
          <path d="M4.5 1.5a.5.5 0 0 0-1 0v9.793L1.854 9.646a.5.5 0 1 0-.708.708l2.5 2.5a.5.5 0 0 0 .708 0l2.5-2.5a.5.5 0 0 0-.708-.708L4.5 11.293zM11.5 14.5a.5.5 0 0 0 1 0V4.707l1.646 1.647a.5.5 0 0 0 .708-.708l-2.5-2.5a.5.5 0 0 0-.708 0l-2.5 2.5a.5.5 0 1 0 .708.708L11.5 4.707z" />
        </svg>
      </button>
    </div>
  )
}
//#endregion
