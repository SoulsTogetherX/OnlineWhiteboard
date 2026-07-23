//#region Imports
import { useId, useState } from "react"

import {
  MAX_CANVAS_DIMENSION,
  MIN_CANVAS_DIMENSION,
} from "@shared/constants/canvas"

import "./styles.css"

import Button from "@/components/Button"
//#endregion

//#region Helpers
// Mirror the server's bound (isValidCanvasDims) so the form cannot submit a
// value the server will reject. The server remains the authority; this exists so
// that a rejection never happens in the first place.
//
// Rounding is part of that, not a nicety: isValidCanvasDims requires INTEGERS,
// so "10.5" survived the old clamp unchanged and was then refused server-side —
// producing exactly the silent nothing-happens this is meant to prevent. Empty
// or unparseable input falls back to the minimum rather than erroring, because
// the whole design here is "always submit something legal".
function clampDimension(value: number): number {
  if (Number.isNaN(value)) {
    return MIN_CANVAS_DIMENSION
  }
  return Math.round(
    Math.max(MIN_CANVAS_DIMENSION, Math.min(MAX_CANVAS_DIMENSION, value)),
  )
}
//#endregion

//#region Component Def
export interface ResizeControlProps {
  // The room's current size, shown and used to pre-fill the inputs.
  width: number
  height: number
  // Only the owner may resize (canManageRoom); disabled otherwise.
  disabled: boolean
  onResize: (width: number, height: number) => void
}

// Owner-only canvas resize. A disclosure button reveals width/height inputs
// pre-filled with the current size; Apply sends the (clamped) new dimensions.
// The resize crops/pads from the top-left server-side and forces a resync, so
// the new size returns as a snapshot — this component just requests it.
export default function ResizeControl({
  width,
  height,
  disabled,
  onResize,
}: ResizeControlProps) {
  const [isOpen, setIsOpen] = useState(false)
  const [widthInput, setWidthInput] = useState(String(width))
  const [heightInput, setHeightInput] = useState(String(height))
  const widthId = useId()
  const heightId = useId()

  // Seed the inputs from the room's CURRENT size each time the form opens, so it
  // always starts from the live dimensions (which change under us when anyone
  // resizes) without a derive-from-props effect. Editing is left alone while
  // open; the closed toggle label reads width/height straight from props.
  const toggle = () => {
    if (!isOpen) {
      setWidthInput(String(width))
      setHeightInput(String(height))
    }
    setIsOpen((open) => !open)
  }

  const submit = (event: React.FormEvent) => {
    event.preventDefault()
    const width = clampDimension(Number(widthInput))
    const height = clampDimension(Number(heightInput))

    // Write the clamped values back into the fields. THIS is the feedback for an
    // out-of-range entry: rather than an error message explaining that 999 is
    // too big, the field simply shows the 512 that was actually applied, so what
    // you see and what the canvas is agree. Silently sending a different number
    // than the one still displayed is the version that feels broken.
    setWidthInput(String(width))
    setHeightInput(String(height))

    onResize(width, height)
    setIsOpen(false)
  }

  return (
    <div className="resize-control">
      <button
        type="button"
        className="resize-toggle"
        onClick={toggle}
        disabled={disabled}
        aria-expanded={isOpen}
      >
        Resize canvas ({width}×{height})
      </button>

      {isOpen && !disabled && (
        // noValidate so an out-of-range typed value still submits and gets
        // clamped by clampDimension — native min/max validation would otherwise
        // silently block the submit, leaving Apply doing nothing. min/max stay
        // on the inputs as spinner bounds and hints.
        <form className="resize-form" noValidate onSubmit={submit}>

          <div className="resize-field">
            <label htmlFor={widthId}>Width</label>
            <input
              id={widthId}
              type="number"
              min={MIN_CANVAS_DIMENSION}
              max={MAX_CANVAS_DIMENSION}
              value={widthInput}
              onChange={(event) => setWidthInput(event.target.value)}
            />
          </div>
          <div className="resize-field">
            <label htmlFor={heightId}>Height</label>
            <input
              id={heightId}
              type="number"
              min={MIN_CANVAS_DIMENSION}
              max={MAX_CANVAS_DIMENSION}
              value={heightInput}
              onChange={(event) => setHeightInput(event.target.value)}
            />
          </div>
          <Button type="submit" variant="primary" size="sm">
            Apply
          </Button>
        </form>
      )}
    </div>
  )
}
//#endregion
