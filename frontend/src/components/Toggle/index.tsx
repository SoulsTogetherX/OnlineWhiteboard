//#region Imports
import type { ReactNode } from "react"

import "./styles.css"
//#endregion

//#region Component Def
export interface ToggleProps {
  checked: boolean
  onChange: (checked: boolean) => void
  label: ReactNode
  // When true the control shows its state read-only and can't be operated.
  disabled?: boolean
}

// A reusable labelled switch. It is a real `<input type="checkbox">` — visually
// hidden but the actual focusable, keyboard-operable control announcing its
// checked state — styled as a sliding switch via CSS. Lifted out of the
// one-off open-editing toggle so every on/off control in the app (open editing,
// cursor visibility, …) shares one implementation (§12.9: shared UI primitives
// live once).
export default function Toggle({
  checked,
  onChange,
  label,
  disabled = false,
}: ToggleProps) {
  return (
    <label className={`toggle${disabled ? " toggle-disabled" : ""}`}>
      <input
        type="checkbox"
        className="toggle-input"
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
      />
      <span className="toggle-track" aria-hidden="true">
        <span className="toggle-thumb" />
      </span>
      <span className="toggle-label">{label}</span>
    </label>
  )
}
//#endregion
