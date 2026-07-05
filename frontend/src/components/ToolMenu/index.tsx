//#region Imports
import "./styles.css"
//#endregion

//#region Constant
const OPEN_TOOL_CLASS = "tool-open"
//#endregion

//#region Component Def
export interface ToolMenuProps {
  isOpen: boolean
  openRoomPicker: () => void
}

export default function ToolMenu({ isOpen, openRoomPicker }: ToolMenuProps) {
  return (
    <div className={`tool-menu ${isOpen ? OPEN_TOOL_CLASS : ""}`}>
      <ul className="tool-list">
        <li>
          <button className="tool-button" onClick={openRoomPicker}>
            <svg
              className="button-icon"
              fill="currentColor"
              viewBox="0 0 16 16"
            >
              <path d="M7 14s-1 0-1-1 1-4 5-4 5 3 5 4-1 1-1 1zm4-6a3 3 0 1 0 0-6 3 3 0 0 0 0 6m-5.784 6A2.24 2.24 0 0 1 5 13c0-1.355.68-2.75 1.936-3.72A6.3 6.3 0 0 0 5 9c-4 0-5 3-5 4s1 1 1 1zM4.5 8a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5" />
            </svg>
            <span className="tool-tip">Room Id</span>
          </button>
        </li>
      </ul>
    </div>
  )
}
//#endregion
