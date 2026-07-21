//#region Imports
import Toggle from "@/components/Toggle"

import "./styles.css"
//#endregion

//#region Component Def
export interface CursorControlsProps {
  showCursors: boolean
  showNames: boolean
  onShowCursorsChange: (value: boolean) => void
  onShowNamesChange: (value: boolean) => void
}

// The viewer's cursor display preferences: hide other people's cursors entirely,
// or keep the arrows but drop the name labels. Presentational — the persisted
// state lives in useCursorPreferences. The name toggle is disabled while cursors
// are hidden, since there is nothing to label.
export default function CursorControls({
  showCursors,
  showNames,
  onShowCursorsChange,
  onShowNamesChange,
}: CursorControlsProps) {
  return (
    <section className="cursor-controls" aria-label="Cursor display">
      <h3 className="cursor-controls-heading">Cursors</h3>
      <Toggle
        checked={showCursors}
        onChange={onShowCursorsChange}
        label="Show other cursors"
      />
      <Toggle
        checked={showNames}
        disabled={!showCursors}
        onChange={onShowNamesChange}
        label="Show cursor names"
      />
    </section>
  )
}
//#endregion
