//#region Imports
import { useEffect } from "react"

import { TOOLS } from "@/components/SideBar/DrawingTab/tools"
import type { AppTool } from "@/components/SideBar/DrawingTab/tools"
//#endregion

//#region Constants
// shortcut key -> tool, derived once from the shared TOOLS descriptors so the
// picker's tooltips and these bindings can never disagree (tools.tsx is the one
// source). Lower-cased because event.key for an unmodified letter is lower-case.
const TOOL_SHORTCUTS: Record<string, AppTool> = Object.fromEntries(
  TOOLS.map((tool) => [tool.shortcut.toLowerCase(), tool.id]),
)
//#endregion

//#region Type Def
export interface UseKeymapOptions {
  // Tool shortcuts only fire while the sidebar (the tool surface) is open; a key
  // press does nothing when the tools aren't on screen.
  sidebarOpen: boolean
  onSelectTool: (tool: AppTool) => void
  onUndo: () => void
  onRedo: () => void
}
//#endregion

//#region Helper Def
// Never hijack a key while the user is typing into a field (a checkpoint name, a
// room id, a resize dimension) — otherwise "s" in a text box would switch tools.
function isTextEntry(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) {
    return false
  }
  const tag = target.tagName
  return tag === "INPUT" || tag === "TEXTAREA" || target.isContentEditable
}
//#endregion

//#region Hook Def
// The app's one keyboard map, replacing the inline Ctrl/Cmd+Z effect App used to
// own. Two groups:
//   - Undo/redo (Ctrl/Cmd+Z, Ctrl/Cmd+Shift+Z) — always active.
//   - Single-key tool shortcuts (P/E/F/S/I) — active only while the sidebar is
//     open, and only unmodified (a modifier means it's some other command, e.g.
//     Ctrl+S = save, so it must not be read as the spray shortcut).
export default function useKeymap({
  sidebarOpen,
  onSelectTool,
  onUndo,
  onRedo,
}: UseKeymapOptions): void {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (isTextEntry(event.target)) {
        return
      }

      const isModified = event.ctrlKey || event.metaKey

      // Undo / redo.
      if (isModified && event.key.toLowerCase() === "z") {
        event.preventDefault()
        if (event.shiftKey) {
          onRedo()
        } else {
          onUndo()
        }
        return
      }

      // Tool shortcuts: unmodified single keys, only while the sidebar is open.
      if (!sidebarOpen || isModified || event.altKey) {
        return
      }
      const tool = TOOL_SHORTCUTS[event.key.toLowerCase()]
      if (tool) {
        event.preventDefault()
        onSelectTool(tool)
      }
    }

    window.addEventListener("keydown", onKeyDown)
    return () => window.removeEventListener("keydown", onKeyDown)
  }, [sidebarOpen, onSelectTool, onUndo, onRedo])
}
//#endregion
