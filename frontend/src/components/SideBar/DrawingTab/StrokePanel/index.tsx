//#region Imports
import LabelledSlider from "@/components/LabelledSlider"

import { MAX_STROKE_SIZE } from "@shared/constants/canvas"
import { MAX_STABILIZATION } from "@/utils/stabilizer"

import "./styles.css"
//#endregion

//#region Component Def
export interface StrokePanelProps {
  // Stroke smoothing, shared by every tool you drag rather than owned by one
  // panel — the setting follows the gesture, not the brush.
  stabilization: number
  onStabilizationChange: (strength: number) => void
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
  stabilization,
  onStabilizationChange,
}: StrokePanelProps) {
  return (
    <div className="stroke-panel">
      <LabelledSlider
        label="Brush size"
        value={strokeSize}
        min={1}
        max={MAX_STROKE_SIZE}
        format={(value) => `${value}px`}
        onChange={onStrokeSizeChange}
      />
      <LabelledSlider
        label="Stabilization"
        value={stabilization}
        min={0}
        max={MAX_STABILIZATION}
        format={(value) => (value === 0 ? "Off" : `${value}`)}
        onChange={onStabilizationChange}
      />
    </div>
  )
}
//#endregion
