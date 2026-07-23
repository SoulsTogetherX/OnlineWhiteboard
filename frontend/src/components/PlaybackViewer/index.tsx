//#region Imports
import { useEffect, useMemo, useRef, useState } from "react"

import PopupBase from "@/components/Popups/PopupBase"

import { computeCheckpointMarks } from "./marks"

import { applyDrawInstructionToCanvas } from "@shared/utils/handleCanvasProtocol"
import { createImageDataFromBase64 } from "@shared/utils/helperProtocolMethods"

import type { PlaybackData } from "@/hooks/useRoomConnection"
import type { CheckpointInfo } from "@shared/types/socketProtocol"

import "./styles.css"
//#endregion

//#region Constants
const STEP_MS = 80
//#endregion

//#region Component
export interface PlaybackViewerProps {
  playback: PlaybackData | null
  // Checkpoints, for the scrubber's tick-marks and prev/next jump. Read-only for
  // everyone — restoring the board to one stays a privileged action on the
  // Timeline tab (unchanged); navigating the timeline is open to all.
  checkpoints: CheckpointInfo[]
  onClose: () => void
}

// Animates a history playback on its OWN canvas — the live board is untouched.
// It reconstructs each frame by starting from the base canvas and applying the
// recorded instructions in order, through the SAME shared function the live
// canvas uses (so a replay looks byte-identical to how it was drawn). Stepping
// forward applies incrementally; scrubbing backward rebuilds from the base.
//
// Routed through PopupBase so the dialog role, aria-modal, Escape-to-close and
// inert are handled once (§12.9) — it previously had role="dialog" but no Escape
// and no inert. Playback is read-only, so anyone (including viewers) may watch.
export default function PlaybackViewer({
  playback,
  checkpoints,
  onClose,
}: PlaybackViewerProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const baseRef = useRef<ImageData | null>(null)
  const workingRef = useRef<ImageData | null>(null)
  const renderedStepRef = useRef(0)

  const [step, setStep] = useState(0)
  const [playing, setPlaying] = useState(true)
  const total = playback?.steps.length ?? 0

  // Checkpoint tick positions in step space; recomputed only when the playback or
  // the checkpoint list changes.
  const marks = useMemo(
    () => (playback ? computeCheckpointMarks(playback.steps, checkpoints) : []),
    [playback, checkpoints],
  )

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
    // The playback message carries the base's dimensions, so a resized room's
    // history animates at the right size. A mismatched length returns null and
    // animates nothing rather than throwing.
    const base = createImageDataFromBase64(playback.base, {
      width: playback.width,
      height: playback.height,
    })
    if (base === null) {
      return
    }
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
    // Match the element to the base's dimensions (a resized room may differ from
    // the default), guarded so an unchanged size does not clear the bitmap.
    if (canvas.width !== base.width || canvas.height !== base.height) {
      canvas.width = base.width
      canvas.height = base.height
    }
    // Going backward: rebuild the working buffer from the base.
    if (step < renderedStepRef.current) {
      working.data.set(base.data)
      renderedStepRef.current = 0
    }
    for (let i = renderedStepRef.current; i < step; i += 1) {
      // "replay": these steps are logged history, already decided. Re-running a
      // patch's CAS here would animate a canvas that never existed.
      applyDrawInstructionToCanvas(
        working,
        playback.steps[i].instruction,
        { width: base.width, height: base.height },
        "replay",
      )
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

  const atEnd = step >= total
  const hasPrevCheckpoint = marks.some((mark) => mark.step < step)
  const hasNextCheckpoint = marks.some((mark) => mark.step > step)
  // Jump the scrub position to the adjacent checkpoint (pausing playback). marks
  // are sorted, so the first ahead / last behind is the neighbour.
  const jumpToCheckpoint = (direction: 1 | -1) => {
    setPlaying(false)
    const target =
      direction === 1
        ? marks.find((mark) => mark.step > step)
        : [...marks].reverse().find((mark) => mark.step < step)
    if (target) {
      setStep(target.step)
    }
  }

  return (
    <PopupBase
      isOpen={playback !== null}
      onClose={onClose}
      label="History playback"
    >
      {/* Gated on playback: the animation effects key off the canvas ref, so it
          exists only while a playback is loaded. */}
      {playback && (
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
              width={playback.width}
              height={playback.height}
            />
          </div>

          <div className="playback-controls">
            {marks.length > 0 && (
              <button
                type="button"
                className="playback-jump"
                onClick={() => jumpToCheckpoint(-1)}
                disabled={!hasPrevCheckpoint}
                aria-label="Previous checkpoint"
              >
                ⏮
              </button>
            )}
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
            {marks.length > 0 && (
              <button
                type="button"
                className="playback-jump"
                onClick={() => jumpToCheckpoint(1)}
                disabled={!hasNextCheckpoint}
                aria-label="Next checkpoint"
              >
                ⏭
              </button>
            )}
            <div className="playback-scrubber">
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
              {marks.length > 0 && total > 0 && (
                <div className="playback-marks" aria-hidden="true">
                  {marks.map((mark) => (
                    <span
                      key={mark.id}
                      className="playback-mark"
                      style={{ left: `${(mark.step / total) * 100}%` }}
                      title={mark.name}
                    />
                  ))}
                </div>
              )}
            </div>
            <span className="playback-count">
              {step} / {total}
            </span>
          </div>
        </div>
      )}
    </PopupBase>
  )
}
//#endregion
