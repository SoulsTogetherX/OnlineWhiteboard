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

// A square-icon dropdown of the drawing tools, rendered as the WAI-ARIA listbox
// pattern. The trigger (aria-haspopup="listbox") is the single Tab stop; opening
// moves focus onto the selected option and Up/Down/Home/End rove between the
// options (roving focus on the real option elements, the same technique the
// TabBar uses). Enter/Space choose, Escape closes and returns focus to the
// trigger, and a click outside or focus leaving the picker dismisses it.
//
// The options are the focusable role="option" elements themselves — not buttons
// nested inside them — so the listbox actually honours the arrow keys it
// advertises. A focusable control that ignored the keyboard would be worse than
// a plain div (§12.9).
export default function ToolPicker({
  selectedTool,
  onSelectTool,
}: ToolPickerProps) {
  const [isOpen, setIsOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLUListElement>(null)
  const active = toolById(selectedTool)

  const optionElements = () => [
    ...(menuRef.current?.querySelectorAll<HTMLLIElement>('[role="option"]') ??
      []),
  ]

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

  // On open, move focus onto the selected option so a keyboard user lands inside
  // the listbox and Up/Down step from the current tool.
  useEffect(() => {
    if (!isOpen) {
      return
    }
    const index = Math.max(
      0,
      TOOLS.findIndex((tool) => tool.id === selectedTool),
    )
    optionElements()[index]?.focus()
    // Only re-run when the menu opens; selectedTool is read once at that moment.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen])

  const closeMenu = (returnFocus = true) => {
    setIsOpen(false)
    if (returnFocus) {
      triggerRef.current?.focus()
    }
  }

  const choose = (tool: AppTool) => {
    onSelectTool(tool)
    closeMenu()
  }

  const onOptionKeyDown = (event: React.KeyboardEvent, index: number) => {
    const items = optionElements()
    switch (event.key) {
      case "ArrowDown":
        event.preventDefault()
        items[(index + 1) % items.length]?.focus()
        break
      case "ArrowUp":
        event.preventDefault()
        items[(index - 1 + items.length) % items.length]?.focus()
        break
      case "Home":
        event.preventDefault()
        items[0]?.focus()
        break
      case "End":
        event.preventDefault()
        items[items.length - 1]?.focus()
        break
      case "Enter":
      case " ":
        event.preventDefault()
        choose(TOOLS[index].id)
        break
      case "Escape":
        event.preventDefault()
        // Don't let Escape also reach a parent (e.g. an enclosing dialog).
        event.stopPropagation()
        closeMenu()
        break
    }
  }

  // Open from the trigger with the keyboard: Down/Up opens (the open effect then
  // focuses the selected option). Enter/Space open via the button's native click.
  const onTriggerKeyDown = (event: React.KeyboardEvent) => {
    if (!isOpen && (event.key === "ArrowDown" || event.key === "ArrowUp")) {
      event.preventDefault()
      setIsOpen(true)
    }
  }

  // Close when focus leaves the picker entirely — e.g. Tab out of the open menu.
  const onBlur = (event: React.FocusEvent) => {
    if (!rootRef.current?.contains(event.relatedTarget as Node)) {
      setIsOpen(false)
    }
  }

  return (
    <div ref={rootRef} className="tool-picker" onBlur={onBlur}>
      <button
        ref={triggerRef}
        type="button"
        className="tool-picker-trigger"
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        aria-label={`Tool: ${active.name}`}
        onClick={() => setIsOpen((open) => !open)}
        onKeyDown={onTriggerKeyDown}
      >
        <span className="tool-picker-icon">{active.icon}</span>
        <span className="tool-picker-name">{active.name}</span>
        <span className="tool-picker-chevron" aria-hidden="true" />
      </button>

      {isOpen && (
        <ul
          ref={menuRef}
          className="tool-picker-menu"
          role="listbox"
          aria-label="Tools"
        >
          {TOOLS.map((tool, index) => {
            const isActive = tool.id === selectedTool
            return (
              <li
                key={tool.id}
                role="option"
                aria-selected={isActive}
                // Not in the Tab order; focus is moved here programmatically
                // (roving focus) so the trigger stays the single Tab stop.
                tabIndex={-1}
                className={`tool-picker-option${isActive ? " tool-picker-option-active" : ""}`}
                onClick={() => choose(tool.id)}
                onKeyDown={(event) => onOptionKeyDown(event, index)}
              >
                <span className="tool-picker-icon">{tool.icon}</span>
                <span className="tool-picker-name">{tool.name}</span>
                <kbd className="tool-picker-shortcut">{tool.shortcut}</kbd>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
//#endregion
