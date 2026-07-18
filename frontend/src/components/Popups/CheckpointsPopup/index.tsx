//#region Imports
import { useState } from "react"

import PopupBase from "@/components/Popups/PopupBase"

import type { CheckpointInfo } from "@shared/types/socketProtocol"

import "./styles.css"
//#endregion

//#region Helpers
function relativeTime(iso: string): string {
  const then = new Date(iso).getTime()
  if (Number.isNaN(then)) return ""
  const mins = Math.max(0, Math.round((Date.now() - then) / 60000))
  if (mins < 1) return "just now"
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.round(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  return `${Math.round(hrs / 24)}d ago`
}
//#endregion

//#region Component
export interface CheckpointsPopupProps {
  isOpen: boolean
  checkpoints: CheckpointInfo[]
  // Owners/editors can save/restore/delete; viewers and guests can only replay.
  canEdit: boolean
  onClose: () => void
  onCreate: (name: string) => void
  onRestore: (checkpointId: string) => void
  onDelete: (checkpointId: string) => void
  onReplay: (fromCheckpointId?: string) => void
}

// Saved versions of the canvas. Editors can save a new checkpoint, jump the live
// board back to one, or delete one; anyone can replay history (a read-only
// animation). The server enforces the edit gate — these controls just mirror it.
export default function CheckpointsPopup({
  isOpen,
  checkpoints,
  canEdit,
  onClose,
  onCreate,
  onRestore,
  onDelete,
  onReplay,
}: CheckpointsPopupProps) {
  const [name, setName] = useState("")

  const save = () => {
    const trimmed = name.trim()
    if (trimmed) {
      onCreate(trimmed)
      setName("")
    }
  }

  return (
    <PopupBase isOpen={isOpen} onClose={onClose} label="Checkpoints">
      <div className="checkpoints-popup">
        <h2 className="checkpoints-title">Checkpoints</h2>

        {canEdit && (
          <div className="checkpoints-create">
            <input
              type="text"
              value={name}
              maxLength={60}
              placeholder="Name this version…"
              aria-label="Checkpoint name"
              onChange={(ev) => setName(ev.target.value)}
              onKeyDown={(ev) => ev.key === "Enter" && save()}
            />
            <button type="button" onClick={save} disabled={!name.trim()}>
              Save
            </button>
          </div>
        )}

        <button
          type="button"
          className="checkpoints-replay-recent"
          onClick={() => onReplay()}
        >
          ▶ Replay recent history
        </button>

        {checkpoints.length === 0 ? (
          <p className="checkpoints-empty">No checkpoints saved yet.</p>
        ) : (
          <ul className="checkpoints-list">
            {checkpoints.map((cp) => (
              <li className="checkpoints-item" key={cp.id}>
                <span className="checkpoints-info">
                  <span className="checkpoints-name">{cp.name}</span>
                  <span className="checkpoints-meta">
                    {relativeTime(cp.createdAt)}
                  </span>
                </span>
                <span className="checkpoints-actions">
                  <button type="button" onClick={() => onReplay(cp.id)}>
                    ▶ Replay
                  </button>
                  {canEdit && (
                    <>
                      <button type="button" onClick={() => onRestore(cp.id)}>
                        Restore
                      </button>
                      <button
                        type="button"
                        className="checkpoints-delete"
                        onClick={() => onDelete(cp.id)}
                        title={`Delete ${cp.name}`}
                      >
                        ✕
                      </button>
                    </>
                  )}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </PopupBase>
  )
}
//#endregion
