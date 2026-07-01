//#region Imports
import "./styles.css"
//#endregion

//#region Component Def
interface NavMenuButtonProps {
  onClick: () => void
}

function NavMenuButton({ onClick }: NavMenuButtonProps) {
  return (
    <button className="nav-menu-button" onClick={onClick}>
      <span></span>
      <span></span>
      <span></span>
    </button>
  )
}
//#endregion

//#region Exports
export type { NavMenuButtonProps }
export default NavMenuButton
//#endregion
