//#region Imports
import type { ConnectionRole, Participant } from "@shared/types/identity"

import "./styles.css"
//#endregion

//#region Role badge
// Small role indicator shown next to a participant. Guests and plain editors
// carry no badge (that's the default); owner and viewer are the ones worth
// flagging in the roster.
const ROLE_BADGE: Partial<Record<ConnectionRole, string>> = {
  owner: "owner",
  viewer: "view only",
}

//#region Component
export interface PresenceRosterProps {
  participants: Participant[]
  // The connection id of this client, so we can mark "(you)" and sort self first.
  selfConnectionId: string | null
}

// The live list of everyone in the room — each with their identity colour and
// name. Replaces the old bare "N active" count with who is actually here.
export default function PresenceRoster({
  participants,
  selfConnectionId,
}: PresenceRosterProps) {
  if (participants.length === 0) {
    return null
  }

  // Put yourself first; keep everyone else in join order.
  const ordered = [...participants].sort((a, b) => {
    if (a.connectionId === selfConnectionId) return -1
    if (b.connectionId === selfConnectionId) return 1
    return 0
  })

  return (
    <section className="presence-roster" aria-label={`${participants.length} in this room`}>
      <h2 className="presence-heading">
        In this room · {participants.length}
      </h2>
      <ul className="presence-list">
        {ordered.map((participant) => {
          const isSelf = participant.connectionId === selfConnectionId
          return (
            <li className="presence-item" key={participant.connectionId}>
              <span
                className="presence-dot"
                style={{ backgroundColor: participant.color }}
                aria-hidden="true"
              />
              <span className="presence-name">
                {participant.name}
                {isSelf && <span className="presence-you"> (you)</span>}
              </span>
              {participant.isGuest ? (
                <span className="presence-guest-tag">guest</span>
              ) : (
                ROLE_BADGE[participant.role] && (
                  <span className={`presence-role-tag role-${participant.role}`}>
                    {ROLE_BADGE[participant.role]}
                  </span>
                )
              )}
            </li>
          )
        })}
      </ul>
    </section>
  )
}
//#endregion
