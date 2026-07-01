//#region Imports
import "./styles.css"
//#endregion

//#region Component
interface ModuleBaseProps {
  children?: React.ReactNode
  isOpen: boolean
  onClose: () => void
}

function ModuleBase({ children, isOpen, onClose }: ModuleBaseProps) {
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
export type { ModuleBaseProps }
export default ModuleBase
//#endregion
