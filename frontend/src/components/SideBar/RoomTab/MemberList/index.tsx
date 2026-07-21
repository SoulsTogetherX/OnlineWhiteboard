//#region Imports
import type { ConnectionRole, Participant } from "@shared/types/identity"

import "./styles.css"
//#endregion

//#region Role badge
// Owner and viewer are the roles worth flagging; a plain editor and a guest tag
// carry their own labels below. (This carries the badge set of the old floating
// PresenceRoster, which this list replaced.)
const ROLE_BADGE: Partial<Record<ConnectionRole, string>> = {
  owner: "owner",
  viewer: "view only",
}
//#endregion

//#region Component Def
export interface MemberListProps {
  participants: Participant[]
  // This client's connection id, to mark "(you)" and sort self first.
  selfConnectionId: string | null
}

// The connected count plus a collapsible roster of who is here. A native
// <details> gives the collapse behaviour, keyboard operation and expanded-state
// announcement for free. Open by default — the count is the summary, so opening
// it is the obvious next glance.
export default function MemberList({
  participants,
  selfConnectionId,
}: MemberListProps) {
  // Put yourself first; keep everyone else in join order.
  const ordered = [...participants].sort((a, b) => {
    if (a.connectionId === selfConnectionId) return -1
    if (b.connectionId === selfConnectionId) return 1
    return 0
  })

  return (
    <details className="member-list" open>
      <summary className="member-list-summary">
        In this room · {participants.length}
      </summary>
      {participants.length === 0 ? (
        <p className="member-list-empty">No one is connected.</p>
      ) : (
        <ul className="member-list-items">
          {ordered.map((participant) => {
            const isSelf = participant.connectionId === selfConnectionId
            return (
              <li className="member-list-item" key={participant.connectionId}>
                <span
                  className="member-dot"
                  style={{ backgroundColor: participant.color }}
                  aria-hidden="true"
                />
                <span className="member-name">
                  {participant.name}
                  {isSelf && <span className="member-you"> (you)</span>}
                </span>
                {participant.isGuest ? (
                  <span className="member-tag member-guest">guest</span>
                ) : (
                  ROLE_BADGE[participant.role] && (
                    <span className={`member-tag role-${participant.role}`}>
                      {ROLE_BADGE[participant.role]}
                    </span>
                  )
                )}
              </li>
            )
          })}
        </ul>
      )}
    </details>
  )
}
//#endregion
