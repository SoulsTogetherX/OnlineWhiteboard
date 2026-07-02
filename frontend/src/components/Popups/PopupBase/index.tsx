//#region Imports
import "./styles.css"
//#endregion

//#region Component
interface PopupBaseProps {
  children?: React.ReactNode
  isOpen: boolean
  onClose: () => void
}

function PopupBase({ children, isOpen, onClose }: PopupBaseProps) {
  return (
    <div
      className={`module-wrapper${isOpen ? " active" : ""}`}
      aria-hidden={!isOpen}
    >
      <div className="module-back" onClick={onClose}></div>
      <div className="module-front">{children}</div>
    </div>
  )
}
//#endregion

//#region Exports
export type { PopupBaseProps }
export default PopupBase
//#endregion
