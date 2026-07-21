//#region Imports
import { useId } from "react"

import "./styles.css"
//#endregion

//#region Component Def
export interface LabelledSliderProps {
  label: string
  value: number
  min: number
  max: number
  onChange: (value: number) => void
  // Optional formatter for the value shown beside the label (e.g. "8px").
  format?: (value: number) => string
  step?: number
}

// A reusable labelled range input: a real `<input type="range">` (keyboard- and
// screen-reader-operable for free) with its label and current value above it.
// Lifted so the stroke-width control and any future slider share one accessible
// implementation instead of re-wiring a label + range each time.
export default function LabelledSlider({
  label,
  value,
  min,
  max,
  onChange,
  format,
  step = 1,
}: LabelledSliderProps) {
  const id = useId()
  const shown = format ? format(value) : String(value)

  return (
    <div className="labelled-slider">
      <label className="labelled-slider-label" htmlFor={id}>
        <span>{label}</span>
        <span className="labelled-slider-value">{shown}</span>
      </label>
      <input
        id={id}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
      />
    </div>
  )
}
//#endregion
