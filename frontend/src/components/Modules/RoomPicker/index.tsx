//#region Imports
import ModuleBase from "../ModuleBase"

import "./styles.css"
//#endregion

//#region Component
interface RoomPickerProps {
  isOpen: boolean
  onClose: () => void
}

function RoomPicker({ isOpen, onClose }: RoomPickerProps) {
  return (
    <ModuleBase isOpen={isOpen} onClose={onClose}>
      <div>
        Name
        <input />
      </div>
      <div>
        Room Id
        <input />
      </div>
      <button onClick={onClose}>Save</button>
    </ModuleBase>
  )
}
//#endregion

//#region Exports
export type { RoomPickerProps }
export default RoomPicker
//#endregion
