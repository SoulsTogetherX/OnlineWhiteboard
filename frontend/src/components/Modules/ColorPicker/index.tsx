//#region Imports
import "../styles.css"
import "./styles.css"
//#endregion

//#region Constant
const MODULE_OPEN_CLASS = "module-open"
//#endregion

//#region Component
interface ColorPickerProps {
  isOpen: boolean
}

function ColorPicker({ isOpen }: ColorPickerProps) {
  return (
    <div
      className={`module color-picker-module ${isOpen ? MODULE_OPEN_CLASS : ""}`}
    ></div>
  )
}
//#endregion

//#region Exports
export type { ColorPickerProps }
export default ColorPicker
//#endregion
