//#region Imports
import PopupBase from "../PopupBase"

import "./styles.css"
//#endregion

//#region Component
interface ColorPopupProps {
  isOpen: boolean
  onClose: () => void
}

function ColorPopup({ isOpen, onClose }: ColorPopupProps) {
  return <PopupBase isOpen={isOpen} onClose={onClose}></PopupBase>
}
//#endregion

//#region Exports
export type { ColorPopupProps }
export default ColorPopup
//#endregion
