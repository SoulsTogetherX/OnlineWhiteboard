//#region Imports
import type { ActiveVote } from "@/hooks/useRoomConnection"

import "./styles.css"
//#endregion

//#region Component
export interface VotePromptProps {
  vote: ActiveVote | null
  onVote: (approve: boolean) => void
}

const ACTION_LABEL: Record<ActiveVote["action"], string> = {
  clear: "clear the canvas",
}

// Shown only to a recent editor while a destructive-action vote is open. Its
// presence is entirely server-driven: the hook sets `vote` from vote_started and
// nulls it on vote_resolved, so this component never decides the outcome — it
// only relays this client's approve/reject.
export default function VotePrompt({ vote, onVote }: VotePromptProps) {
  if (!vote) {
    return null
  }

  return (
    <div className="vote-prompt" role="alertdialog" aria-label="Action vote">
      <p className="vote-prompt-text">
        <strong>{vote.initiatorName}</strong> wants to{" "}
        {ACTION_LABEL[vote.action]}.
      </p>
      <p className="vote-prompt-tally">
        {vote.approvals} of {vote.voters} approved
      </p>
      <div className="vote-prompt-actions">
        <button type="button" onClick={() => onVote(false)}>
          Reject
        </button>
        <button
          type="button"
          className="vote-prompt-approve"
          onClick={() => onVote(true)}
        >
          Approve
        </button>
      </div>
    </div>
  )
}
//#endregion
