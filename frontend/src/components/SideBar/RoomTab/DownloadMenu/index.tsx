//#region Imports
import { useEffect, useRef, useState } from "react"

import IconButton from "@/components/IconButton"

import { EXPORT_FORMATS } from "@/utils/downloadImage"
import type { ExportFormat } from "@/utils/downloadImage"

import "./styles.css"
//#endregion

//#region Icons
function DownloadIcon() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <path d="M.5 9.9a.5.5 0 0 1 .5.5v2.5a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-2.5a.5.5 0 0 1 1 0v2.5a2 2 0 0 1-2 2H2a2 2 0 0 1-2-2v-2.5a.5.5 0 0 1 .5-.5" />
      <path d="M7.646 11.854a.5.5 0 0 0 .708 0l3-3a.5.5 0 0 0-.708-.708L8.5 10.293V1.5a.5.5 0 0 0-1 0v8.793L5.354 8.146a.5.5 0 1 0-.708.708z" />
    </svg>
  )
}
//#endregion

//#region Component Def
export interface DownloadMenuProps {
  onDownload: (format: ExportFormat) => void
}

// The download control: a button that opens a format list rather than saving a
// PNG outright, because "which format" is a real question — PNG for fidelity,
// WebP for size, JPEG for compatibility with things that reject PNG, BMP for
// tooling old enough to predate both.
//
// Each option states what it costs you (JPEG and BMP cannot store transparency)
// so the choice is informed at the point of making it, not discovered afterwards
// when the erased areas turn out white.
export default function DownloadMenu({ onDownload }: DownloadMenuProps) {
  const [open, setOpen] = useState(false)
  const wrapRef = useRef<HTMLDivElement>(null)

  // Dismiss on an outside click or Escape — the two ways anyone expects to
  // close a menu. Bound only while open, so there is no listener sitting on the
  // document for a menu nobody has touched.
  useEffect(() => {
    if (!open) {
      return
    }
    const onPointerDown = (event: PointerEvent) => {
      if (!wrapRef.current?.contains(event.target as Node)) {
        setOpen(false)
      }
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false)
      }
    }
    document.addEventListener("pointerdown", onPointerDown)
    document.addEventListener("keydown", onKeyDown)
    return () => {
      document.removeEventListener("pointerdown", onPointerDown)
      document.removeEventListener("keydown", onKeyDown)
    }
  }, [open])

  return (
    <div className="download-menu" ref={wrapRef}>
      <IconButton
        label="Download image"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        aria-haspopup="menu"
      >
        <DownloadIcon />
      </IconButton>

      {open && (
        <div className="download-menu-list" role="menu" aria-label="Download format">
          {EXPORT_FORMATS.map((format) => (
            <button
              key={format.id}
              type="button"
              role="menuitem"
              className="download-menu-item"
              onClick={() => {
                setOpen(false)
                onDownload(format.id)
              }}
            >
              <span className="download-menu-label">{format.label}</span>
              {format.caveat && (
                <span className="download-menu-caveat">{format.caveat}</span>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
//#endregion
