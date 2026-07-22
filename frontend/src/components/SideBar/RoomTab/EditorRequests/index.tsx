//#region Imports
import Button from "@/components/Button"

import type { EditorRequest } from "@shared/types/socketProtocol"

import "./styles.css"
//#endregion

//#region Component Def
export interface EditorRequestsProps {
  // Only ever populated for an owner — the server sends the list to nobody else,
  // so the parent renders this only when isOwner. Empty means nothing pending.
  requests: EditorRequest[]
  onRespond: (userId: string, approve: boolean) => void
}

// The owner's queue of viewers asking for editor access, each with approve/deny.
// Renders nothing when the queue is empty so the tab isn't cluttered with an
// empty section.
export default function EditorRequests({
  requests,
  onRespond,
}: EditorRequestsProps) {
  if (requests.length === 0) {
    return null
  }

  return (
    <section className="editor-requests" aria-label="Editor access requests">
      <h3 className="editor-requests-heading">Editor requests</h3>
      <ul className="editor-requests-list">
        {requests.map((request) => (
          <li className="editor-request" key={request.userId}>
            <span className="editor-request-name">{request.name}</span>
            <span className="editor-request-actions">
              <Button
                variant="promoted"
                size="sm"
                onClick={() => onRespond(request.userId, true)}
                aria-label={`Approve ${request.name}`}
              >
                Approve
              </Button>
              <Button
                size="sm"
                onClick={() => onRespond(request.userId, false)}
                aria-label={`Deny ${request.name}`}
              >
                Deny
              </Button>
            </span>
          </li>
        ))}
      </ul>
    </section>
  )
}
//#endregion
