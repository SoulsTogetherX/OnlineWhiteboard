//#region Imports
import { useEffect } from "react"

import { cycleRecentSlider } from "@/utils/recentSlider"

import { TOOLS } from "@/components/SideBar/DrawingTab/tools"
import type { AppTool } from "@/components/SideBar/DrawingTab/tools"
//#endregion

//#region Constants
// Cycles which slider the scroll wheel drives. D because it sits under the
// drawing hand's fingers on a standard layout and no tool claims it — this has
// to be reachable DURING a stroke, with the other hand still on the pointer.
const CYCLE_SLIDER_KEY = "d"
export const CYCLE_SLIDER_LABEL = "D"

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
  // Announces which slider the wheel now drives, so the change is visible
  // without looking away from the canvas.
  onCycleSlider?: (label: string | null) => void
}
//#endregion

//#region Helper Def
// Never hijack a key while the user is typing into a field (a checkpoint name, a
// room id, a resize dimension) — otherwise "s" in a text box would switch tools.
// Only TEXT entry, not every <input>.
//
// Treating the whole INPUT tag as typing was wrong in a way that only shows up
// once the sidebar has sliders: clicking one leaves it focused, and from then on
// every shortcut was swallowed — including the very one meant to be used while
// drawing, which is reachable exactly when a slider was the last thing touched.
// A range, checkbox or radio consumes no letters, so no letter needs protecting
// from it.
const TEXT_INPUT_TYPES = new Set([
  "text",
  "search",
  "url",
  "tel",
  "email",
  "password",
  "number",
  "date",
  "datetime-local",
  "month",
  "week",
  "time",
])

function isTextEntry(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) {
    return false
  }
  if (target.isContentEditable || target.tagName === "TEXTAREA") {
    return true
  }
  if (target instanceof HTMLInputElement) {
    // An input with no type attribute defaults to text.
    return TEXT_INPUT_TYPES.has(target.type || "text")
  }
  return false
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
  onCycleSlider,
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

      // Deliberately BEFORE the sidebar gate and outside the "unmodified only"
      // rule for shift: this is the one shortcut whose whole purpose is to work
      // mid-stroke, and shift+` cycles backwards. It still respects ctrl/meta,
      // which belong to the browser.
      // toLowerCase so it fires with caps lock on, and so shift+D (cycle
      // backwards) still matches the key rather than arriving as "D".
      if (!isModified && event.key.toLowerCase() === CYCLE_SLIDER_KEY) {
        event.preventDefault()
        // Cycle FIRST, then notify. Written as
        // `onCycleSlider?.(cycleRecentSlider(...))` this silently did nothing:
        // an optional call short-circuits its ARGUMENTS as well as the call, so
        // with no listener attached the cycle never ran at all. The work has to
        // sit outside the optional call; only the notification is optional.
        const label = cycleRecentSlider(event.shiftKey ? -1 : 1)
        onCycleSlider?.(label)
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
  }, [sidebarOpen, onSelectTool, onUndo, onRedo, onCycleSlider])
}
//#endregion
