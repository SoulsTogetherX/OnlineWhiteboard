//#region Imports
import IconButton from "@/components/IconButton"

import ToolPicker from "./ToolPicker"
import ColorControls from "./ColorControls"
import StrokePanel from "./StrokePanel"
import { toolById } from "./tools"
import type { AppTool } from "./tools"

import type { ColorPalette } from "@shared/types/primitive"

import "./styles.css"
//#endregion

//#region Icons
function UndoIcon() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <path
        fillRule="evenodd"
        d="M8 3a5 5 0 1 1-4.546 2.914.5.5 0 0 0-.908-.417A6 6 0 1 0 8 2z"
      />
      <path d="M8 4.466V.534a.25.25 0 0 0-.41-.192L5.23 2.308a.25.25 0 0 0 0 .384l2.36 1.966A.25.25 0 0 0 8 4.466" />
    </svg>
  )
}

function RedoIcon() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <path
        fillRule="evenodd"
        d="M8 3a5 5 0 1 0 4.546 2.914.5.5 0 0 1 .908-.417A6 6 0 1 1 8 2z"
      />
      <path d="M8 4.466V.534a.25.25 0 0 1 .41-.192l2.36 1.966c.12.1.12.284 0 .384L8.41 4.658A.25.25 0 0 1 8 4.466" />
    </svg>
  )
}
//#endregion

//#region Component Def
export interface DrawingTabProps {
  selectedTool: AppTool
  onSelectTool: (tool: AppTool) => void
  strokeSize: number
  onStrokeSizeChange: (size: number) => void
  colorPalette: React.RefObject<ColorPalette>
  onSwap: () => void
  openColorPopup: (primary: boolean) => void
  onUndo: () => void
  onRedo: () => void
  canUndo: boolean
  canRedo: boolean
}

// The Drawing tab: a thin composition of the tool picker, undo/redo, colour
// controls, and a contextual panel that appears only for the active tool (the
// stroke slider for pencil/eraser).
export default function DrawingTab({
  selectedTool,
  onSelectTool,
  strokeSize,
  onStrokeSizeChange,
  colorPalette,
  onSwap,
  openColorPopup,
  onUndo,
  onRedo,
  canUndo,
  canRedo,
}: DrawingTabProps) {
  const activeTool = toolById(selectedTool)

  return (
    <div className="drawing-tab">
      <div className="drawing-tab-tools">
        <ToolPicker selectedTool={selectedTool} onSelectTool={onSelectTool} />
        <div className="drawing-tab-history">
          <IconButton
            label="Undo"
            shortcut="Ctrl+Z"
            onClick={onUndo}
            disabled={!canUndo}
          >
            <UndoIcon />
          </IconButton>
          <IconButton
            label="Redo"
            shortcut="Ctrl+Shift+Z"
            onClick={onRedo}
            disabled={!canRedo}
          >
            <RedoIcon />
          </IconButton>
        </div>
      </div>

      <ColorControls
        colorPalette={colorPalette}
        onSwap={onSwap}
        openColorPopup={openColorPopup}
      />

      {/* Contextual: only the stroke-based tools show the brush-size panel. */}
      {activeTool.usesStroke && (
        <StrokePanel
          strokeSize={strokeSize}
          onStrokeSizeChange={onStrokeSizeChange}
        />
      )}
    </div>
  )
}
//#endregion
