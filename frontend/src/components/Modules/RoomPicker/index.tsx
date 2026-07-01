//#region Imports
import "../styles.css"
import "./styles.css"
//#endregion

//#region Constant
const MODULE_OPEN_CLASS = "module-open"
//#endregion

//#region Component
interface RoomPickerProps {
  isOpen: boolean
}

function RoomPicker({ isOpen }: RoomPickerProps) {
  return (
    <div
      className={`module room-picker-module ${isOpen ? MODULE_OPEN_CLASS : ""}`}
    >
      Test
    </div>
  )
}
//#endregion

//#region Exports
export type { RoomPickerProps }
export default RoomPicker
//#endregion
