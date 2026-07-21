//#region Imports
import { useEffect, useRef, useState } from "react"

import { TOOLS, toolById } from "../tools"
import type { AppTool } from "../tools"

import "./styles.css"
//#endregion

//#region Component Def
export interface ToolPickerProps {
  selectedTool: AppTool
  onSelectTool: (tool: AppTool) => void
}

// A square-icon dropdown of the drawing tools. The trigger shows the active
// tool; opening reveals the full list with each tool's name and single-key
// shortcut. Presentational — it only reports the chosen tool. Closes on Escape,
// on selecting, and on a click outside.
export default function ToolPicker({
  selectedTool,
  onSelectTool,
}: ToolPickerProps) {
  const [isOpen, setIsOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const active = toolById(selectedTool)

  // Click-outside to dismiss, only while open.
  useEffect(() => {
    if (!isOpen) {
      return
    }
    const onPointerDown = (event: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) {
        setIsOpen(false)
      }
    }
    document.addEventListener("pointerdown", onPointerDown)
    return () => document.removeEventListener("pointerdown", onPointerDown)
  }, [isOpen])

  const choose = (tool: AppTool) => {
    onSelectTool(tool)
    setIsOpen(false)
  }

  return (
    <div
      ref={rootRef}
      className="tool-picker"
      onKeyDown={(event) => {
        if (event.key === "Escape" && isOpen) {
          event.stopPropagation()
          setIsOpen(false)
        }
      }}
    >
      <button
        type="button"
        className="tool-picker-trigger"
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        aria-label={`Tool: ${active.name}`}
        onClick={() => setIsOpen((open) => !open)}
      >
        <span className="tool-picker-icon">{active.icon}</span>
        <span className="tool-picker-name">{active.name}</span>
        <span className="tool-picker-chevron" aria-hidden="true" />
      </button>

      {isOpen && (
        <ul className="tool-picker-menu" role="listbox" aria-label="Tools">
          {TOOLS.map((tool) => {
            const isActive = tool.id === selectedTool
            return (
              <li key={tool.id} role="option" aria-selected={isActive}>
                <button
                  type="button"
                  className={`tool-picker-option${isActive ? " tool-picker-option-active" : ""}`}
                  onClick={() => choose(tool.id)}
                >
                  <span className="tool-picker-icon">{tool.icon}</span>
                  <span className="tool-picker-name">{tool.name}</span>
                  <kbd className="tool-picker-shortcut">{tool.shortcut}</kbd>
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
//#endregion
