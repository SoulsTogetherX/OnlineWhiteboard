//#region Imports
import CheckpointList from "./CheckpointList"

import type { CheckpointInfo } from "@shared/types/socketProtocol"

import "./styles.css"
//#endregion

//#region Component Def
export interface TimelineTabProps {
  checkpoints: CheckpointInfo[]
  // Whether this connection may save/restore/delete checkpoints (owner/editor).
  // Replay is available to everyone regardless.
  canEdit: boolean
  onCreate: (name: string) => void
  onRestore: (checkpointId: string) => void
  onDelete: (checkpointId: string) => void
  onReplay: (fromCheckpointId?: string) => void
}

// The Timeline tab: named checkpoints (save/restore/delete for editors) and
// history replay for everyone. Replay opens the playback overlay, which carries
// the scrubber; this tab is the checkpoint surface.
export default function TimelineTab({
  checkpoints,
  canEdit,
  onCreate,
  onRestore,
  onDelete,
  onReplay,
}: TimelineTabProps) {
  return (
    <div className="timeline-tab">
      <p className="timeline-hint">
        Replay animates history in an overlay — the live board is untouched.
        {canEdit
          ? " Save a checkpoint to keep a version you can restore to."
          : " Only owners and editors can save or restore versions."}
      </p>
      <CheckpointList
        checkpoints={checkpoints}
        canEdit={canEdit}
        onCreate={onCreate}
        onRestore={onRestore}
        onDelete={onDelete}
        onReplay={onReplay}
      />
    </div>
  )
}
//#endregion
