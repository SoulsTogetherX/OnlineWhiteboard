//#region Imports
import LabelledSlider from "@/components/LabelledSlider"

import { MAX_SPRAY_DENSITY, MAX_STROKE_SIZE } from "@shared/constants/canvas"
import { MAX_STABILIZATION } from "@/utils/stabilizer"

import "./styles.css"
//#endregion

//#region Component Def
export interface SprayPanelProps {
  // Stroke smoothing, shared by every tool you drag rather than owned by one
  // panel — the setting follows the gesture, not the brush.
  stabilization: number
  onStabilizationChange: (strength: number) => void
  // Size drives the puff RADIUS via the shared brush-size value (base.size), so
  // it reuses the stroke-size setter.
  strokeSize: number
  onStrokeSizeChange: (size: number) => void
  // Density is spray-only: pixels scattered per puff.
  sprayDensity: number
  onSprayDensityChange: (density: number) => void
}

// The contextual panel for the spray can: a size slider (the puff radius) and an
// independent density slider. The spray previously had no controls at all — its
// radius came from the hidden stroke size and density was derived from it.
export default function SprayPanel({
  strokeSize,
  onStrokeSizeChange,
  stabilization,
  onStabilizationChange,
  sprayDensity,
  onSprayDensityChange,
}: SprayPanelProps) {
  return (
    <div className="spray-panel">
      <LabelledSlider
        label="Spray size"
        value={strokeSize}
        min={1}
        max={MAX_STROKE_SIZE}
        format={(value) => `${value}px`}
        onChange={onStrokeSizeChange}
      />
      <LabelledSlider
        label="Density"
        value={sprayDensity}
        min={1}
        max={MAX_SPRAY_DENSITY}
        format={(value) => `${value}`}
        onChange={onSprayDensityChange}
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
