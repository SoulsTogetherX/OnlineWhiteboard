//#region Imports
import { useState } from "react"

import { colorTypeToString } from "@shared/types/primitive"
import type { ColorPalette } from "@shared/types/primitive"

import "./styles.css"
//#endregion

//#region Component Def
export interface ColorSelectorProps {
  colorPalette: React.RefObject<ColorPalette>
  /** Swaps primary/secondary AND persists the result to sessionStorage. */
  onSwap: () => void
  openColorPopup: (primary: boolean) => void
}

export default function ColorSelector({
  colorPalette,
  onSwap,
  openColorPopup,
}: ColorSelectorProps) {
  // Purely a render trigger and a position toggle — the palette itself lives in
  // the ref. Flipping this is what drives the CSS slide animation below.
  const [isSwapped, setIsSwapped] = useState<boolean>(false)

  const primaryColor = colorTypeToString(colorPalette.current.primary)
  const secondaryColor = colorTypeToString(colorPalette.current.secondary)

  const swapHandler = () => {
    // This used to destructure-swap colorPalette.current in place, bypassing
    // useColorPalette entirely. The swap worked on screen but was never written
    // to sessionStorage, so it silently reverted on reload — while a swap made
    // via the ColorPopup's Apply *did* persist. onSwap routes through the hook's
    // setter, so there is now one path and it always persists.
    onSwap()
    setIsSwapped((swapped) => !swapped)
  }

  // Reordering these two entries (rather than restyling them) is deliberate and
  // load-bearing: the two <button>s below carry NO `key`, so React reconciles
  // them by index, reuses the same two DOM nodes, and only swaps their
  // `top`/`bottom` class — which is what lets `transition: transform` animate
  // the swatches sliding past each other. Giving them keys would make React
  // reorder the nodes instead, and the colors would flip with no animation.
  const [info1, info2] = isSwapped
    ? [
        { pos: "top", color: primaryColor, isPrimary: true },
        { pos: "bottom", color: secondaryColor, isPrimary: false },
      ]
    : [
        { pos: "bottom", color: secondaryColor, isPrimary: false },
        { pos: "top", color: primaryColor, isPrimary: true },
      ]

  const label = (isPrimary: boolean) =>
    `Change ${isPrimary ? "primary" : "secondary"} color`

  return (
    // Stays a plain div. The swap used to hang off an onClick here — on a
    // non-focusable element with no role and no key handler, so swapping was
    // mouse-only and invisible to assistive tech. The brush below is now the
    // swap control, which is also what the README already documents.
    <div className="color-picker-wrapper">
      <button
        type="button"
        className={`color-picker ${info1.pos}`}
        style={{ backgroundColor: info1.color }}
        // Each swatch had no text and no aria-label, so both announced as a
        // bare "button" with no way to tell primary from secondary.
        aria-label={label(info1.isPrimary)}
        onClick={() => openColorPopup(info1.isPrimary)}
      ></button>
      <button
        type="button"
        className={`color-picker ${info2.pos}`}
        style={{ backgroundColor: info2.color }}
        aria-label={label(info2.isPrimary)}
        onClick={() => openColorPopup(info2.isPrimary)}
      ></button>

      {/* key forces a remount so the CSS twirl animation replays on each swap. */}
      <button
        type="button"
        className="color-icon"
        key={Number(isSwapped)}
        onClick={swapHandler}
        aria-label="Swap primary and secondary colors"
      >
        <svg fill="currentColor" viewBox="0 0 16 16" aria-hidden="true">
          <path d="M15.825.12a.5.5 0 0 1 .132.584c-1.53 3.43-4.743 8.17-7.095 10.64a6.1 6.1 0 0 1-2.373 1.534c-.018.227-.06.538-.16.868-.201.659-.667 1.479-1.708 1.74a8.1 8.1 0 0 1-3.078.132 4 4 0 0 1-.562-.135 1.4 1.4 0 0 1-.466-.247.7.7 0 0 1-.204-.288.62.62 0 0 1 .004-.443c.095-.245.316-.38.461-.452.394-.197.625-.453.867-.826.095-.144.184-.297.287-.472l.117-.198c.151-.255.326-.54.546-.848.528-.739 1.201-.925 1.746-.896q.19.012.348.048c.062-.172.142-.38.238-.608.261-.619.658-1.419 1.187-2.069 2.176-2.67 6.18-6.206 9.117-8.104a.5.5 0 0 1 .596.04M4.705 11.912a1.2 1.2 0 0 0-.419-.1c-.246-.013-.573.05-.879.479-.197.275-.355.532-.5.777l-.105.177c-.106.181-.213.362-.32.528a3.4 3.4 0 0 1-.76.861c.69.112 1.736.111 2.657-.12.559-.139.843-.569.993-1.06a3 3 0 0 0 .126-.75zm1.44.026c.12-.04.277-.1.458-.183a5.1 5.1 0 0 0 1.535-1.1c1.9-1.996 4.412-5.57 6.052-8.631-2.59 1.927-5.566 4.66-7.302 6.792-.442.543-.795 1.243-1.042 1.826-.121.288-.214.54-.275.72v.001l.575.575zm-4.973 3.04.007-.005zm3.582-3.043.002.001h-.002z" />
        </svg>
      </button>
    </div>
  )
}
//#endregion
