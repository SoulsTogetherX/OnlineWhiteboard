//#region Imports
import "./styles.css"
//#endregion

//#region Component Def
export interface OpenEditingToggleProps {
  // The room's current open-editing setting (settings.openEditing).
  enabled: boolean
  // Only the owner may change it; for everyone else it shows the state read-only.
  disabled: boolean
  onChange: (enabled: boolean) => void
}

// The guest-draw toggle. When on, viewers and guests may draw (canDraw); when
// off, only owner/editor. A real checkbox so it is keyboard-operable and
// announces its checked state for free — styled as a switch via CSS.
export default function OpenEditingToggle({
  enabled,
  disabled,
  onChange,
}: OpenEditingToggleProps) {
  return (
    <label className={`open-editing-toggle${disabled ? " is-disabled" : ""}`}>
      <input
        type="checkbox"
        className="open-editing-input"
        checked={enabled}
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
      />
      <span className="open-editing-track" aria-hidden="true">
        <span className="open-editing-thumb" />
      </span>
      <span className="open-editing-label">Let guests &amp; viewers draw</span>
    </label>
  )
}
//#endregion
