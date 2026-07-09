//#region Imports
import "./styles.css"
//#endregion

//#region Component Def
export interface HamburgerButtonProps {
  onClick: () => void
}

export default function HamburgerButton({ onClick }: HamburgerButtonProps) {
  return (
    <button className="hamburger-button" onClick={onClick}>
      <span></span>
      <span></span>
      <span></span>
    </button>
  )
}
//#endregion
