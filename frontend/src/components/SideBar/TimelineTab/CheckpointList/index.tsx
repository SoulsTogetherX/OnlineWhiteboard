//#region Imports
import { useState } from "react"

import { relativeTime } from "@/utils/relativeTime"

import type { CheckpointInfo } from "@shared/types/socketProtocol"

import "./styles.css"
//#endregion

//#region Component Def
export interface CheckpointListProps {
  checkpoints: CheckpointInfo[]
  // Owners/editors can save/restore/delete; viewers and guests can only replay.
  // The server enforces this — these controls just mirror it.
  canEdit: boolean
  onCreate: (name: string) => void
  onRestore: (checkpointId: string) => void
  onDelete: (checkpointId: string) => void
  onReplay: (fromCheckpointId?: string) => void
}

// The saved-version list: editors save a new checkpoint or jump the live board
// back to one; anyone can replay history (a read-only animation, opened in the
// playback overlay). Presentational.
export default function CheckpointList({
  checkpoints,
  canEdit,
  onCreate,
  onRestore,
  onDelete,
  onReplay,
}: CheckpointListProps) {
  const [name, setName] = useState("")

  const save = () => {
    const trimmed = name.trim()
    if (trimmed) {
      onCreate(trimmed)
      setName("")
    }
  }

  return (
    <div className="checkpoint-list">
      {canEdit && (
        <div className="checkpoint-create">
          <input
            type="text"
            value={name}
            maxLength={60}
            placeholder="Name this version…"
            aria-label="Checkpoint name"
            onChange={(event) => setName(event.target.value)}
            onKeyDown={(event) => event.key === "Enter" && save()}
          />
          <button type="button" onClick={save} disabled={!name.trim()}>
            Save
          </button>
        </div>
      )}

      <button
        type="button"
        className="checkpoint-replay-recent"
        onClick={() => onReplay()}
      >
        ▶ Replay recent history
      </button>

      {checkpoints.length === 0 ? (
        <p className="checkpoint-empty">No checkpoints saved yet.</p>
      ) : (
        <ul className="checkpoint-items">
          {checkpoints.map((checkpoint) => (
            <li className="checkpoint-item" key={checkpoint.id}>
              <span className="checkpoint-info">
                <span className="checkpoint-name">{checkpoint.name}</span>
                <span className="checkpoint-meta">
                  {relativeTime(checkpoint.createdAt)}
                </span>
              </span>
              <span className="checkpoint-actions">
                <button type="button" onClick={() => onReplay(checkpoint.id)}>
                  ▶ Replay
                </button>
                {canEdit && (
                  <>
                    <button
                      type="button"
                      onClick={() => onRestore(checkpoint.id)}
                    >
                      Restore
                    </button>
                    <button
                      type="button"
                      className="checkpoint-delete"
                      onClick={() => onDelete(checkpoint.id)}
                      aria-label={`Delete ${checkpoint.name}`}
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
  )
}
//#endregion
