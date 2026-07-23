//#region Imports
import LabelledSlider from "@/components/LabelledSlider"
import Toggle from "@/components/Toggle"

import {
  MAX_BLUR_BLEND,
  MAX_BLUR_OPACITY,
  MAX_STROKE_SIZE,
} from "@shared/constants/canvas"

import "./styles.css"
//#endregion

//#region Component Def
export interface BlurPanelProps {
  // Reuses the shared stroke size, so "size 8" means a comparable footprint
  // whichever brush you are holding.
  strokeSize: number
  onStrokeSizeChange: (size: number) => void
  blurBlend: number
  onBlurBlendChange: (blend: number) => void
  blurOpacity: number
  onBlurOpacityChange: (opacity: number) => void
  lockAlpha: boolean
  onLockAlphaChange: (locked: boolean) => void
}

// The blur brush's controls. Three sliders that answer three different
// questions, which is why none of them collapses into another:
//
//   Size    — how much of the canvas this touches at all.
//   Blend   — how far each touched pixel reaches for its average, i.e. how soft
//             the result is. A small strong smudge and a big soft one are
//             different tools, and one number cannot express both.
//   Opacity — how much of the blurred value is mixed in. Below 100 the effect
//             builds up over repeated passes instead of resolving on contact.
export default function BlurPanel({
  strokeSize,
  onStrokeSizeChange,
  blurBlend,
  onBlurBlendChange,
  blurOpacity,
  onBlurOpacityChange,
  lockAlpha,
  onLockAlphaChange,
}: BlurPanelProps) {
  return (
    <div className="blur-panel">
      <LabelledSlider
        label="Blur size"
        value={strokeSize}
        min={1}
        max={MAX_STROKE_SIZE}
        format={(value) => `${value}px`}
        onChange={onStrokeSizeChange}
      />
      <LabelledSlider
        label="Blending"
        value={blurBlend}
        min={1}
        max={MAX_BLUR_BLEND}
        format={(value) => `${value}px`}
        onChange={onBlurBlendChange}
      />
      <LabelledSlider
        label="Opacity"
        value={blurOpacity}
        min={1}
        max={MAX_BLUR_OPACITY}
        format={(value) => `${value}%`}
        onChange={onBlurOpacityChange}
      />
      <Toggle
        checked={lockAlpha}
        onChange={onLockAlphaChange}
        label="Lock alpha"
      />
      <p className="blur-panel-hint">
        Lock alpha keeps the drawing&apos;s shape and softens only the colour
        inside it.
      </p>
    </div>
  )
}
//#endregion
