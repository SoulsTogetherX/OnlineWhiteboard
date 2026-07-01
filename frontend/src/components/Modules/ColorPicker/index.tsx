//#region Imports
import ModuleBase from "../ModuleBase"

import "./styles.css"
//#endregion

//#region Component
interface ColorPickerProps {
  isOpen: boolean
  onClose: () => void
}

function ColorPicker({ isOpen, onClose }: ColorPickerProps) {
  return (
    <ModuleBase isOpen={isOpen} onClose={onClose}>
      <div></div>
    </ModuleBase>
  )
}
//#endregion

//#region Exports
export type { ColorPickerProps }
export default ColorPicker
//#endregion
