//#region Imports
import CheckpointList from "./CheckpointList"

import type { CheckpointInfo } from "@shared/types/socketProtocol"

import "./styles.css"
//#endregion

//#region Component Def
export interface RoomHistoryProps {
  checkpoints: CheckpointInfo[]
  // Whether this connection may save/restore/delete checkpoints (owner/editor).
  // Replay is available to everyone regardless.
  canEdit: boolean
  onCreate: (name: string) => void
  onRestore: (checkpointId: string) => void
  onDelete: (checkpointId: string) => void
  onReplay: (fromCheckpointId?: string) => void
}

// The room's history: named checkpoints (save/restore/delete for editors) and
// replay for everyone. Replay opens the playback overlay, which carries the
// scrubber; this is the checkpoint surface.
//
// This was a sidebar tab of its own. It became a section of the Room tab because
// a room's history is a fact ABOUT that room — you reach for it in the same
// frame of mind as its members, its size and its permissions — and the tab it
// vacated now holds the account.
export default function RoomHistory({
  checkpoints,
  canEdit,
  onCreate,
  onRestore,
  onDelete,
  onReplay,
}: RoomHistoryProps) {
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
