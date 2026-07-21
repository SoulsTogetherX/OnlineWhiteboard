//#region Imports
import type { ReactNode } from "react"

import "./styles.css"
//#endregion

//#region Component Def
export interface IconButtonProps {
  // The accessible name. Always required — an icon with no text label announces
  // as just "button" (the bug HamburgerButton originally had). Doubles as the
  // hover/focus tooltip text.
  label: string
  onClick: () => void
  // The icon, typically an <svg aria-hidden>. The label above carries meaning,
  // so the icon itself must be decorative.
  children: ReactNode
  disabled?: boolean
  // For controls that report an on/off or selected state to assistive tech
  // (a tool being active, a toggle being on). Omitted for plain actions.
  pressed?: boolean
  // Shown after the label in the tooltip, e.g. a keyboard shortcut ("B"). The
  // Drawing tab's tools carry these; most Room controls don't.
  shortcut?: string
  // Extra classes for per-use sizing/emphasis without duplicating the base.
  className?: string
}

// A reusable square icon button with a hover/focus tooltip. Lifted into one
// place so the tabs stop copy-pasting the icon+tooltip markup ToolMenu grew
// (§12.9: shared UI primitives live once, not per tab). Presentational — it only
// reports clicks.
export default function IconButton({
  label,
  onClick,
  children,
  disabled = false,
  pressed,
  shortcut,
  className,
}: IconButtonProps) {
  return (
    <button
      type="button"
      className={`icon-button${className ? ` ${className}` : ""}`}
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      aria-pressed={pressed}
    >
      {children}
      {/* The tooltip is aria-hidden: the accessible name already comes from
          aria-label, so exposing the same text again would double-announce. */}
      <span className="icon-button-tooltip" aria-hidden="true">
        {label}
        {shortcut && <span className="icon-button-shortcut">{shortcut}</span>}
      </span>
    </button>
  )
}
//#endregion
