//#region Imports
import { useEffect } from "react"

import "./styles.css"
//#endregion

//#region Component
export interface PopupBaseProps {
  children?: React.ReactNode
  isOpen: boolean
  onClose: () => void
  /** Accessible name for the dialog, announced when it opens. */
  label: string
}

export default function PopupBase({
  children,
  isOpen,
  onClose,
  label,
}: PopupBaseProps) {
  // Escape-to-close is the baseline expectation for any modal; there was no key
  // handling at all, so a keyboard user who opened a popup could only leave it
  // by tabbing to a button. Bound to the window rather than the dialog because
  // focus is not moved into the dialog on open.
  useEffect(() => {
    if (!isOpen) {
      return
    }

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault()
        onClose()
      }
    }

    window.addEventListener("keydown", onKeyDown)
    return () => window.removeEventListener("keydown", onKeyDown)
  }, [isOpen, onClose])

  return (
    <div
      className={`popup-wrapper${isOpen ? " active" : ""}`}
      role="dialog"
      aria-modal="true"
      aria-label={label}
      // `isOpen` only toggles a class; children are never unmounted, and the
      // closed state is `opacity: 0` — which hides the popup visually but does
      // NOT remove it from the tab order or the accessibility tree. Keyboard
      // users could tab into invisible inputs and buttons. `inert` fixes both,
      // and also makes the dialog role inactive while closed.
      inert={!isOpen}
    >
      <div className="popup-back" onClick={onClose}></div>
      <div className="popup-front">{children}</div>
    </div>
  )
}
//#endregion
