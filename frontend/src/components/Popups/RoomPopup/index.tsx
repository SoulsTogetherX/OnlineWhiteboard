//#region Imports
import PopupBase from "../PopupBase"

import "./styles.css"
//#endregion

//#region Component
interface RoomPopupProps {
  isOpen: boolean
  onClose: () => void
}

function RoomPopup({ isOpen, onClose }: RoomPopupProps) {
  return (
    <PopupBase isOpen={isOpen} onClose={onClose}>
      <div>
        Name
        <input />
      </div>
      <div>
        Room Id
        <input />
      </div>
      <button onClick={onClose}>Load</button>
    </PopupBase>
  )
}
//#endregion

//#region Exports
export type { RoomPopupProps }
export default RoomPopup
//#endregion
