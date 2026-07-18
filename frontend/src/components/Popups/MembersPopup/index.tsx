//#region Imports
import PopupBase from "@/components/Popups/PopupBase"
import useRoomMembers from "@/hooks/useRoomMembers"

import type { RoomRole } from "@shared/types/identity"

import "./styles.css"
//#endregion

//#region Component
export interface MembersPopupProps {
  isOpen: boolean
  roomId: string
  onClose: () => void
}

const ASSIGNABLE_ROLES: RoomRole[] = ["owner", "editor", "viewer"]

// Lists a room's members. The owner gets a role dropdown and a remove button per
// member; everyone else sees a read-only roster. All decisions are enforced
// server-side — this UI just reflects what the API allows and shows its errors.
export default function MembersPopup({
  isOpen,
  roomId,
  onClose,
}: MembersPopupProps) {
  const { members, myRole, error, changeRole, removeMember } = useRoomMembers(
    roomId,
    isOpen,
  )
  const isOwner = myRole === "owner"

  return (
    <PopupBase isOpen={isOpen} onClose={onClose} label="Room members">
      <div className="members-popup">
        <h2 className="members-title">Members of {roomId}</h2>

        {error && <p className="members-error">{error}</p>}

        {members.length === 0 && !error ? (
          <p className="members-empty">No registered members yet.</p>
        ) : (
          <ul className="members-list">
            {members.map((member) => (
              <li className="members-item" key={member.userId}>
                <span
                  className="members-dot"
                  style={{ backgroundColor: member.color }}
                  aria-hidden="true"
                />
                <span className="members-name">{member.username}</span>

                {isOwner ? (
                  <span className="members-controls">
                    <label className="members-role-label">
                      <span className="visually-hidden">
                        Role for {member.username}
                      </span>
                      <select
                        value={member.role}
                        onChange={(ev) =>
                          void changeRole(
                            member.userId,
                            ev.target.value as RoomRole,
                          )
                        }
                      >
                        {ASSIGNABLE_ROLES.map((role) => (
                          <option key={role} value={role}>
                            {role}
                          </option>
                        ))}
                      </select>
                    </label>
                    {member.role !== "owner" && (
                      <button
                        type="button"
                        className="members-remove"
                        onClick={() => void removeMember(member.userId)}
                        title={`Remove ${member.username}`}
                      >
                        Remove
                      </button>
                    )}
                  </span>
                ) : (
                  <span className={`members-role-tag role-${member.role}`}>
                    {member.role}
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}

        {isOwner && (
          <p className="members-hint">
            Promote a member to <strong>owner</strong> to hand over the room —
            you become an editor.
          </p>
        )}
      </div>
    </PopupBase>
  )
}
//#endregion
