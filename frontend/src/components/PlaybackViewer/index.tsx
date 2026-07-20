//#region Imports
import { useEffect, useRef, useState } from "react"

import { applyDrawInstructionToCanvas } from "@shared/utils/handleCanvasProtocol"
import { createImageDataFromBase64 } from "@shared/utils/helperProtocolMethods"
import { CANVAS_HEIGHT, CANVAS_WIDTH } from "@shared/constants/canvas"

import type { PlaybackData } from "@/hooks/useRoomConnection"

import "./styles.css"
//#endregion

//#region Constants
const STEP_MS = 80
//#endregion

//#region Component
export interface PlaybackViewerProps {
  playback: PlaybackData | null
  onClose: () => void
}

// Animates a history playback on its OWN canvas — the live board is untouched.
// It reconstructs each frame by starting from the base canvas and applying the
// recorded instructions in order, through the SAME shared function the live
// canvas uses (so a replay looks byte-identical to how it was drawn). Stepping
// forward applies incrementally; scrubbing backward rebuilds from the base.
export default function PlaybackViewer({
  playback,
  onClose,
}: PlaybackViewerProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const baseRef = useRef<ImageData | null>(null)
  const workingRef = useRef<ImageData | null>(null)
  const renderedStepRef = useRef(0)

  const [step, setStep] = useState(0)
  const [playing, setPlaying] = useState(true)
  const total = playback?.steps.length ?? 0

  // Reset the position when a NEW playback arrives. Done during render (the
  // allowed React pattern for "adjust state when a prop changes", also used by
  // ColorPopup) rather than in an effect, so it doesn't trip the "setState in an
  // effect" lint rule.
  const [seen, setSeen] = useState(playback)
  if (playback !== seen) {
    setSeen(playback)
    setStep(0)
    setPlaying(total > 0)
  }

  // Decode the base into the working buffer — refs only, no state — when the
  // playback changes.
  useEffect(() => {
    if (!playback) {
      return
    }
    const base = createImageDataFromBase64(playback.base)
    baseRef.current = base
    workingRef.current = new ImageData(
      new Uint8ClampedArray(base.data),
      base.width,
      base.height,
    )
    renderedStepRef.current = 0
  }, [playback])

  // Sync the canvas to `step`.
  useEffect(() => {
    const canvas = canvasRef.current
    const base = baseRef.current
    const working = workingRef.current
    if (!canvas || !base || !working || !playback) {
      return
    }
    const ctx = canvas.getContext("2d")
    if (!ctx) {
      return
    }
    // Going backward: rebuild the working buffer from the base.
    if (step < renderedStepRef.current) {
      working.data.set(base.data)
      renderedStepRef.current = 0
    }
    for (let i = renderedStepRef.current; i < step; i += 1) {
      // "replay": these steps are logged history, already decided. Re-running a
      // patch's CAS here would animate a canvas that never existed.
      applyDrawInstructionToCanvas(working, playback.steps[i].instruction, "replay")
    }
    renderedStepRef.current = step
    ctx.putImageData(working, 0, 0)
  }, [step, playback])

  // Advance while playing; one timer per step. At the end it simply stops
  // scheduling (no setState needed) — the button label derives "done" from
  // step >= total, so `playing` staying true is harmless.
  useEffect(() => {
    if (!playing || !playback || step >= total) {
      return
    }
    const id = setTimeout(() => setStep((s) => s + 1), STEP_MS)
    return () => clearTimeout(id)
  }, [playing, playback, step, total])

  if (!playback) {
    return null
  }

  const atEnd = step >= total
  return (
    <div className="playback-overlay" role="dialog" aria-label="History playback">
      <div className="playback-panel">
        <header className="playback-header">
          <h2 className="playback-title">History playback</h2>
          <button type="button" className="playback-close" onClick={onClose}>
            Close
          </button>
        </header>

        <div className="playback-stage">
          <canvas
            ref={canvasRef}
            className="playback-canvas"
            width={CANVAS_WIDTH}
            height={CANVAS_HEIGHT}
          />
        </div>

        <div className="playback-controls">
          <button
            type="button"
            onClick={() => {
              if (atEnd) {
                setStep(0)
                setPlaying(true)
              } else {
                setPlaying((p) => !p)
              }
            }}
          >
            {playing && !atEnd ? "⏸ Pause" : atEnd ? "↻ Replay" : "▶ Play"}
          </button>
          <input
            type="range"
            min={0}
            max={total}
            value={step}
            aria-label="Playback position"
            onChange={(ev) => {
              setPlaying(false)
              setStep(Number(ev.target.value))
            }}
          />
          <span className="playback-count">
            {step} / {total}
          </span>
        </div>
      </div>
    </div>
  )
}
//#endregion
