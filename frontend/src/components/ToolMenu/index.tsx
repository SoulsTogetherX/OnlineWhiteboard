//#region Imports
import { MAX_STROKE_SIZE } from "@shared/constants/canvas"

import type { ToolType } from "@shared/types/drawProtocol"

import "./styles.css"
//#endregion

//#region Constant
const OPEN_TOOL_CLASS = "tool-open"
// Referenced by HamburgerButton's aria-controls, which tells assistive tech
// which element the button expands.
export const TOOL_MENU_ID = "tool-menu"
//#endregion

//#region Types
// The toolbar's selectable tools. "eyedropper" is a frontend-only tool — it
// samples a colour rather than producing a draw instruction — so it lives here
// alongside the real ToolTypes rather than in the shared draw protocol.
export type AppTool = ToolType | "eyedropper"
//#endregion

//#region Component Def
export interface ToolMenuProps {
  isOpen: boolean
  selectedTool: AppTool
  onSelectTool: (type: AppTool) => void
  strokeSize: number
  onStrokeSizeChange: (size: number) => void
  openRoomPicker: () => void
  onClear: () => void
  onUndo: () => void
  onRedo: () => void
  canUndo: boolean
  canRedo: boolean
}

// Presentational. It used to receive the `drawAction` ref and write to it
// directly — mutating a prop, which is both a React anti-pattern and the reason
// the toolbar could never show the active tool (a ref write triggers no
// re-render, so there was no `.active` style because the feature was
// impossible). App now owns the selection and passes it down, so this component
// only reports clicks and renders what it is told.
export default function ToolMenu({
  isOpen,
  selectedTool,
  onSelectTool,
  strokeSize,
  onStrokeSizeChange,
  openRoomPicker,
  onClear,
  onUndo,
  onRedo,
  canUndo,
  canRedo,
}: ToolMenuProps) {
  const setTool = (type: AppTool) => onSelectTool(type)

  const toolClass = (type: AppTool) =>
    `tool-button${selectedTool === type ? " tool-button-active" : ""}`

  return (
    <nav
      id={TOOL_MENU_ID}
      className={`tool-menu${isOpen ? ` ${OPEN_TOOL_CLASS}` : ""}`}
      aria-label="Drawing tools"
      // When closed the menu is only translated off-screen, so it stayed
      // focusable and present in the accessibility tree — keyboard users could
      // tab into invisible controls. `inert` removes it from both.
      inert={!isOpen}
    >
      <ul className="tool-list">
        <li>
          <button
            type="button"
            className={toolClass("pencil")}
            aria-pressed={selectedTool === "pencil"}
            onClick={() => setTool("pencil")}
          >
            <svg
              className="button-icon"
              fill="currentColor"
              viewBox="0 0 16 16"
              aria-hidden="true"
            >
              <path d="M15.825.12a.5.5 0 0 1 .132.584c-1.53 3.43-4.743 8.17-7.095 10.64a6.1 6.1 0 0 1-2.373 1.534c-.018.227-.06.538-.16.868-.201.659-.667 1.479-1.708 1.74a8.1 8.1 0 0 1-3.078.132 4 4 0 0 1-.562-.135 1.4 1.4 0 0 1-.466-.247.7.7 0 0 1-.204-.288.62.62 0 0 1 .004-.443c.095-.245.316-.38.461-.452.394-.197.625-.453.867-.826.095-.144.184-.297.287-.472l.117-.198c.151-.255.326-.54.546-.848.528-.739 1.201-.925 1.746-.896q.19.012.348.048c.062-.172.142-.38.238-.608.261-.619.658-1.419 1.187-2.069 2.176-2.67 6.18-6.206 9.117-8.104a.5.5 0 0 1 .596.04M4.705 11.912a1.2 1.2 0 0 0-.419-.1c-.246-.013-.573.05-.879.479-.197.275-.355.532-.5.777l-.105.177c-.106.181-.213.362-.32.528a3.4 3.4 0 0 1-.76.861c.69.112 1.736.111 2.657-.12.559-.139.843-.569.993-1.06a3 3 0 0 0 .126-.75zm1.44.026c.12-.04.277-.1.458-.183a5.1 5.1 0 0 0 1.535-1.1c1.9-1.996 4.412-5.57 6.052-8.631-2.59 1.927-5.566 4.66-7.302 6.792-.442.543-.795 1.243-1.042 1.826-.121.288-.214.54-.275.72v.001l.575.575zm-4.973 3.04.007-.005zm3.582-3.043.002.001h-.002z" />
            </svg>
            <span className="tool-tip">Pencil</span>
          </button>
        </li>
        <li>
          <button
            type="button"
            className={toolClass("eraser")}
            aria-pressed={selectedTool === "eraser"}
            onClick={() => setTool("eraser")}
          >
            <svg
              className="button-icon"
              fill="currentColor"
              viewBox="0 0 16 16"
              aria-hidden="true"
            >
              <path d="M8.086 2.207a2 2 0 0 1 2.828 0l3.879 3.879a2 2 0 0 1 0 2.828l-5.5 5.5A2 2 0 0 1 7.879 15H5.12a2 2 0 0 1-1.414-.586l-2.5-2.5a2 2 0 0 1 0-2.828zm2.121.707a1 1 0 0 0-1.414 0L4.16 7.547l5.293 5.293 4.633-4.633a1 1 0 0 0 0-1.414zM8.746 13.547 3.453 8.254 1.914 9.793a1 1 0 0 0 0 1.414l2.5 2.5a1 1 0 0 0 .707.293H7.88a1 1 0 0 0 .707-.293z" />
            </svg>
            <span className="tool-tip">Eraser</span>
          </button>
        </li>
        <li>
          <button
            type="button"
            className={toolClass("bucket")}
            aria-pressed={selectedTool === "bucket"}
            onClick={() => setTool("bucket")}
          >
            <svg
              className="button-icon"
              fill="currentColor"
              viewBox="0 0 16 16"
              aria-hidden="true"
            >
              <path d="M6.192 2.78c-.458-.677-.927-1.248-1.35-1.643a3 3 0 0 0-.71-.515c-.217-.104-.56-.205-.882-.02-.367.213-.427.63-.43.896-.003.304.064.664.173 1.044.196.687.556 1.528 1.035 2.402L.752 8.22c-.277.277-.269.656-.218.918.055.283.187.593.36.903.348.627.92 1.361 1.626 2.068.707.707 1.441 1.278 2.068 1.626.31.173.62.305.903.36.262.05.64.059.918-.218l5.615-5.615c.118.257.092.512.05.939-.03.292-.068.665-.073 1.176v.123h.003a1 1 0 0 0 1.993 0H14v-.057a1 1 0 0 0-.004-.117c-.055-1.25-.7-2.738-1.86-3.494a4 4 0 0 0-.211-.434c-.349-.626-.92-1.36-1.627-2.067S8.857 3.052 8.23 2.704c-.31-.172-.62-.304-.903-.36-.262-.05-.64-.058-.918.219zM4.16 1.867c.381.356.844.922 1.311 1.632l-.704.705c-.382-.727-.66-1.402-.813-1.938a3.3 3.3 0 0 1-.131-.673q.137.09.337.274m.394 3.965c.54.852 1.107 1.567 1.607 2.033a.5.5 0 1 0 .682-.732c-.453-.422-1.017-1.136-1.564-2.027l1.088-1.088q.081.181.183.365c.349.627.92 1.361 1.627 2.068.706.707 1.44 1.278 2.068 1.626q.183.103.365.183l-4.861 4.862-.068-.01c-.137-.027-.342-.104-.608-.252-.524-.292-1.186-.8-1.846-1.46s-1.168-1.32-1.46-1.846c-.147-.265-.225-.47-.251-.607l-.01-.068zm2.87-1.935a2.4 2.4 0 0 1-.241-.561c.135.033.324.11.562.241.524.292 1.186.8 1.846 1.46.45.45.83.901 1.118 1.31a3.5 3.5 0 0 0-1.066.091 11 11 0 0 1-.76-.694c-.66-.66-1.167-1.322-1.458-1.847z" />
            </svg>
            <span className="tool-tip">Paint Bucket</span>
          </button>
        </li>
        <li>
          <button
            type="button"
            className={toolClass("spray")}
            aria-pressed={selectedTool === "spray"}
            onClick={() => setTool("spray")}
          >
            <svg
              className="button-icon"
              fill="currentColor"
              viewBox="0 0 16 16"
              aria-hidden="true"
            >
              <path d="M3 2a1 1 0 0 1 1-1h1a1 1 0 0 1 1 1v1.5a1 1 0 0 1 .5.866l.5.289a2 2 0 0 1 1 1.732V14a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V6.387a2 2 0 0 1 1-1.732l.5-.289A1 1 0 0 1 5 3.5V2zm7.5 1a.5.5 0 1 1 1 0 .5.5 0 0 1-1 0m2-1a.5.5 0 1 1 1 0 .5.5 0 0 1-1 0m-2 3a.5.5 0 1 1 1 0 .5.5 0 0 1-1 0m3 0a.5.5 0 1 1 1 0 .5.5 0 0 1-1 0m-1.5 2.5a.5.5 0 1 1 1 0 .5.5 0 0 1-1 0M14 5a.5.5 0 1 1 1 0 .5.5 0 0 1-1 0m-1 3a.5.5 0 1 1 1 0 .5.5 0 0 1-1 0" />
            </svg>
            <span className="tool-tip">Spray Can</span>
          </button>
        </li>
        <li>
          <button
            type="button"
            className={toolClass("eyedropper")}
            aria-pressed={selectedTool === "eyedropper"}
            onClick={() => setTool("eyedropper")}
          >
            <svg
              className="button-icon"
              fill="currentColor"
              viewBox="0 0 16 16"
              aria-hidden="true"
            >
              <path d="M13.354.646a1.207 1.207 0 0 0-1.708 0L8.5 3.793l-.646-.647a.5.5 0 1 0-.708.708L8.293 5l-7.147 7.146A.5.5 0 0 0 1 12.5v1.793l-.854.853a.5.5 0 1 0 .708.707L1.707 15H3.5a.5.5 0 0 0 .354-.146L11 7.707l1.146 1.147a.5.5 0 0 0 .708-.708l-.647-.646 3.147-3.146a1.207 1.207 0 0 0 0-1.708zM10.293 7 3.293 14H2v-1.293l7-7z" />
            </svg>
            <span className="tool-tip">Eyedropper</span>
          </button>
        </li>
        <li>
          <button
            type="button"
            className="tool-button"
            disabled={!canUndo}
            onClick={onUndo}
          >
            <svg
              className="button-icon"
              fill="currentColor"
              viewBox="0 0 16 16"
              aria-hidden="true"
            >
              <path
                fillRule="evenodd"
                d="M8 3a5 5 0 1 1-4.546 2.914.5.5 0 0 0-.908-.417A6 6 0 1 0 8 2z"
              />
              <path d="M8 4.466V.534a.25.25 0 0 0-.41-.192L5.23 2.308a.25.25 0 0 0 0 .384l2.36 1.966A.25.25 0 0 0 8 4.466" />
            </svg>
            <span className="tool-tip">Undo</span>
          </button>
        </li>
        <li>
          <button
            type="button"
            className="tool-button"
            disabled={!canRedo}
            onClick={onRedo}
          >
            <svg
              className="button-icon"
              fill="currentColor"
              viewBox="0 0 16 16"
              aria-hidden="true"
            >
              <path
                fillRule="evenodd"
                d="M8 3a5 5 0 1 0 4.546 2.914.5.5 0 0 1 .908-.417A6 6 0 1 1 8 2z"
              />
              <path d="M8 4.466V.534a.25.25 0 0 1 .41-.192l2.36 1.966c.12.1.12.284 0 .384L8.41 4.658A.25.25 0 0 1 8 4.466" />
            </svg>
            <span className="tool-tip">Redo</span>
          </button>
        </li>
        <li>
          <button type="button" className="tool-button" onClick={openRoomPicker}>
            <svg
              className="button-icon"
              fill="currentColor"
              viewBox="0 0 16 16"
              aria-hidden="true"
            >
              <path d="M7 14s-1 0-1-1 1-4 5-4 5 3 5 4-1 1-1 1zm4-6a3 3 0 1 0 0-6 3 3 0 0 0 0 6m-5.784 6A2.24 2.24 0 0 1 5 13c0-1.355.68-2.75 1.936-3.72A6.3 6.3 0 0 0 5 9c-4 0-5 3-5 4s1 1 1 1zM4.5 8a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5" />
            </svg>
            <span className="tool-tip">Room Id</span>
          </button>
        </li>
        <li>
          <button
            type="button"
            className="tool-button"
            onClick={onClear}
            title="Clear the canvas (needs a vote if others drew recently)"
          >
            <svg
              className="button-icon"
              fill="currentColor"
              viewBox="0 0 16 16"
              aria-hidden="true"
            >
              <path d="M5.5 5.5A.5.5 0 0 1 6 6v6a.5.5 0 0 1-1 0V6a.5.5 0 0 1 .5-.5m2.5 0a.5.5 0 0 1 .5.5v6a.5.5 0 0 1-1 0V6a.5.5 0 0 1 .5-.5m3 .5a.5.5 0 0 0-1 0v6a.5.5 0 0 0 1 0z" />
              <path d="M14.5 3a1 1 0 0 1-1 1H13v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V4h-.5a1 1 0 0 1-1-1V2a1 1 0 0 1 1-1H6a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1h3.5a1 1 0 0 1 1 1zM4.118 4 4 4.059V13a1 1 0 0 0 1 1h6a1 1 0 0 0 1-1V4.059L11.882 4zM2.5 3h11V2h-11z" />
            </svg>
            <span className="tool-tip">Clear Canvas</span>
          </button>
        </li>
      </ul>

      <div className="stroke-size-control">
        <label htmlFor="stroke-size">Size: {strokeSize}px</label>
        <input
          id="stroke-size"
          type="range"
          min={1}
          max={MAX_STROKE_SIZE}
          value={strokeSize}
          onChange={(ev) => onStrokeSizeChange(Number(ev.target.value))}
          aria-label="Brush size"
        />
      </div>
    </nav>
  )
}
//#endregion
