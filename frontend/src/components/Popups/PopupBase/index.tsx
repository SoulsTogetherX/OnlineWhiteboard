//#region Imports
import "./styles.css"
//#endregion

//#region Component
export interface PopupBaseProps {
  children?: React.ReactNode
  isOpen: boolean
  onClose: () => void
}

export default function PopupBase({
  children,
  isOpen,
  onClose,
}: PopupBaseProps) {
  return (
    <div className={`popup-wrapper${isOpen ? " active" : ""}`}>
      <div className="popup-back" onClick={onClose}></div>
      <div className="popup-front">{children}</div>
    </div>
  )
}
//#endregion
