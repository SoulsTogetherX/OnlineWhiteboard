//#region Imports
import { TOOL_MENU_ID } from "@/components/ToolMenu"

import "./styles.css"
//#endregion

//#region Component Def
export interface HamburgerButtonProps {
  isOpen: boolean
  onClick: () => void
}

export default function HamburgerButton({
  isOpen,
  onClick,
}: HamburgerButtonProps) {
  return (
    <button
      type="button"
      className="hamburger-button"
      // The app wrapper has an onClick that closes the toolbar (click-outside
      // to dismiss). Without stopPropagation this button set the toolbar open,
      // the event bubbled to that wrapper, and the same render batch set it
      // closed again — last write wins, so the menu could never open. It looked
      // fine only because CSS forced the toolbar visible on desktop.
      onClick={(event) => {
        event.stopPropagation()
        onClick()
      }}
      // Three empty <span>s compute to an empty accessible name, so this button
      // was announced as just "button" with no indication of what it does.
      aria-label={isOpen ? "Close tools" : "Open tools"}
      aria-expanded={isOpen}
      aria-controls={TOOL_MENU_ID}
    >
      {/* Decorative — the bars are the icon; the label above carries meaning. */}
      <span aria-hidden="true"></span>
      <span aria-hidden="true"></span>
      <span aria-hidden="true"></span>
    </button>
  )
}
//#endregion
