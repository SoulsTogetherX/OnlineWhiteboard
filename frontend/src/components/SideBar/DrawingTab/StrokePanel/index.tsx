//#region Imports
import { useRef } from "react"

import LabelledSlider from "@/components/LabelledSlider"
import useFocusFirstSlider from "@/hooks/useFocusFirstSlider"

import { MAX_STROKE_SIZE } from "@shared/constants/canvas"

import "./styles.css"
//#endregion

//#region Component Def
export interface StrokePanelProps {
  strokeSize: number
  onStrokeSizeChange: (size: number) => void
}

// The contextual panel for stroke-based tools (pencil/eraser): the brush-size
// slider. The Drawing tab renders it only for tools whose descriptor declares
// usesStroke, so it disappears for the bucket/eyedropper. A distinct component
// (rather than a bare slider inline) so per-tool contextual controls have a home
// to grow into.
export default function StrokePanel({
  strokeSize,
  onStrokeSizeChange,
}: StrokePanelProps) {
  // Selecting a stroke tool mounts this panel, which focuses the size slider so
  // the wheel sizes the brush until you draw. See useFocusFirstSlider.
  const panelRef = useRef<HTMLDivElement>(null)
  useFocusFirstSlider(panelRef)

  return (
    <div className="stroke-panel" ref={panelRef}>
      <LabelledSlider
        label="Brush size"
        value={strokeSize}
        min={1}
        max={MAX_STROKE_SIZE}
        format={(value) => `${value}px`}
        onChange={onStrokeSizeChange}
      />
    </div>
  )
}
//#endregion
