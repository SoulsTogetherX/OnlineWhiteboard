//#region Imports
import { useEffect, useMemo, useRef } from "react"


import type { Participant } from "@shared/types/identity"
import type { Vec } from "@shared/types/primitive"

import "./styles.css"
//#endregion

//#region Component
export interface CursorOverlayProps {
  canvasRef: React.RefObject<HTMLCanvasElement | null>
  // Live positions, mutated outside React (see useRoomConnection).
  cursorsRef: React.RefObject<Map<string, Vec>>
  // Which cursors to render — changes only when one appears/disappears.
  cursorIds: string[]
  // Source of each cursor's colour and name.
  participants: Participant[]
}

// Renders other people's cursors over the canvas. The set of cursor NODES is
// React-rendered (one per id), but their POSITIONS are updated imperatively in a
// requestAnimationFrame loop — cursor moves arrive ~20x/second and the canvas
// can be panned/zoomed at 60fps, so driving position through React state would
// mean constant re-renders. Reading getBoundingClientRect each frame is what
// keeps cursors glued to the right canvas pixel through any pan or zoom.
export default function CursorOverlay({
  canvasRef,
  cursorsRef,
  cursorIds,
  participants,
}: CursorOverlayProps) {
  const nodeRefs = useRef<Map<string, HTMLDivElement>>(new Map())

  const participantById = useMemo(
    () => new Map(participants.map((p) => [p.connectionId, p])),
    [participants],
  )

  const hasCursors = cursorIds.length > 0

  useEffect(() => {
    if (!hasCursors) {
      return
    }

    let raf = 0
    const tick = () => {
      const canvas = canvasRef.current
      if (canvas) {
        const rect = canvas.getBoundingClientRect()
        // Scale from the element's OWN canvas dimensions — the room's actual
        // size once a snapshot has sized it — so a resized room maps remote
        // cursor positions to the right on-screen spot.
        const scaleX = rect.width / canvas.width
        const scaleY = rect.height / canvas.height

        for (const [id, node] of nodeRefs.current) {
          const pos = cursorsRef.current.get(id)
          if (!pos) {
            node.style.opacity = "0"
            continue
          }
          // +0.5 centres on the pixel rather than its top-left corner.
          const x = rect.left + (pos[0] + 0.5) * scaleX
          const y = rect.top + (pos[1] + 0.5) * scaleY
          node.style.opacity = "1"
          node.style.transform = `translate(${x}px, ${y}px)`
        }
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [canvasRef, cursorsRef, hasCursors])

  return (
    <div className="cursor-overlay" aria-hidden="true">
      {cursorIds.map((id) => {
        const participant = participantById.get(id)
        if (!participant) {
          return null
        }
        return (
          <div
            key={id}
            className="remote-cursor"
            ref={(el) => {
              if (el) {
                nodeRefs.current.set(id, el)
              } else {
                nodeRefs.current.delete(id)
              }
            }}
          >
            <svg
              className="remote-cursor-arrow"
              width="18"
              height="18"
              viewBox="0 0 18 18"
              fill={participant.color}
            >
              {/* Classic pointer, tip at (0,0) so the node's translate lands the
                  tip exactly on the cursor pixel. */}
              <path
                d="M0 0 L0 13 L3.5 9.5 L6 15 L8.5 14 L6 8.5 L11 8.5 Z"
                stroke="white"
                strokeWidth="1"
              />
            </svg>
            <span
              className="remote-cursor-label"
              style={{ backgroundColor: participant.color }}
            >
              {participant.name}
            </span>
          </div>
        )
      })}
    </div>
  )
}
//#endregion
