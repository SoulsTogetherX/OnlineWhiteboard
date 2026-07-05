//#region Imports
import "./styles.css"
//#endregion

//#region Component Def
export interface NavMenuButtonProps {
  onClick: () => void
}

export default function NavMenuButton({ onClick }: NavMenuButtonProps) {
  return (
    <button className="nav-menu-button" onClick={onClick}>
      <span></span>
      <span></span>
      <span></span>
    </button>
  )
}
//#endregion
