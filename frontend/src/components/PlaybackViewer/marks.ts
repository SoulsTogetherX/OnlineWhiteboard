//#region Imports
import type { CheckpointInfo, PlaybackStep } from "@shared/types/socketProtocol"
//#endregion

//#region Type Def
export interface CheckpointMark {
  id: string
  name: string
  // Scrub position in step space (0..steps.length): the number of steps at or
  // below the checkpoint's revision, i.e. the frame at which the checkpoint's
  // state is reached. Positioned on the scrubber at `step / steps.length`.
  step: number
}
//#endregion

//#region Helper
// Maps each checkpoint onto a scrubber position. `steps` is ascending by revision
// (the server sends it so), so the number of steps at or below a checkpoint's
// revision is a prefix count — the scrub position where that checkpoint sits.
// After uniform decimation a checkpoint's exact revision may no longer be a step,
// but the prefix count still lands on the nearest retained frame.
//
// Checkpoints outside the playback's step range are dropped: step 0 (at or before
// the base — nothing to jump to) and, implicitly, any beyond the last step clamp
// to steps.length (the end), which is kept. Result is sorted by position.
export function computeCheckpointMarks(
  steps: PlaybackStep[],
  checkpoints: CheckpointInfo[],
): CheckpointMark[] {
  return checkpoints
    .map((checkpoint) => {
      let step = 0
      while (step < steps.length && steps[step].revision <= checkpoint.revision) {
        step += 1
      }
      return { id: checkpoint.id, name: checkpoint.name, step }
    })
    .filter((mark) => mark.step > 0 && mark.step <= steps.length)
    .sort((a, b) => a.step - b.step)
}
//#endregion
