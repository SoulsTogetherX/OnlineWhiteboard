//#region Imports
import { useEffect, useRef } from "react"

import { createImageDataFromBase64 } from "@shared/utils/helperProtocolMethods"
import { CANVAS_HEIGHT, CANVAS_WIDTH } from "@shared/constants/canvas"

import "./thumbnail.css"
//#endregion

//#region Component
export interface RoomThumbnailProps {
  roomId: string
}

// A preview of a room's canvas. Fetches the raw RGBA bytes from
// /api/rooms/:id/snapshot and paints them onto a canvas at native resolution;
// CSS scales it down for display (the browser downsamples). No image encoding
// anywhere — the same base64 bytes the WebSocket sends on join, reused.
export default function RoomThumbnail({ roomId }: RoomThumbnailProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    let cancelled = false
    fetch(`/api/rooms/${encodeURIComponent(roomId)}/snapshot`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data: { data: string } | null) => {
        const canvas = canvasRef.current
        if (cancelled || !data || !canvas) {
          return
        }
        const ctx = canvas.getContext("2d")
        if (!ctx) {
          return
        }
        // Reuses the same shared decoder the live canvas uses.
        ctx.putImageData(createImageDataFromBase64(data.data), 0, 0)
      })
      .catch(() => {
        /* a missing preview just renders blank — not worth surfacing */
      })
    return () => {
      cancelled = true
    }
  }, [roomId])

  return (
    <div className="room-thumb-frame">
      <canvas
        ref={canvasRef}
        className="room-thumb"
        width={CANVAS_WIDTH}
        height={CANVAS_HEIGHT}
        aria-hidden="true"
      />
    </div>
  )
}
//#endregion
