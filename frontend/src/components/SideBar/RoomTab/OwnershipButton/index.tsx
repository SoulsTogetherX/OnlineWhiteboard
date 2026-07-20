//#region Imports
import "./styles.css"
//#endregion

//#region Component Def
export interface OwnershipButtonProps {
  // Whether THIS connection owns the room (canManageRoom(self.role)).
  isOwner: boolean
  // Whether the room has any owner at all (settings.hasOwner).
  hasOwner: boolean
  // Guests have no account to attach persistent ownership to, so they can't
  // claim — the button explains why rather than failing on the server.
  isGuest: boolean
  onClaim: () => void
  onRelease: () => void
}

// The single ownership control that transforms between claim and release
// depending on who owns the room, per the spec. Three cases, one button:
//   - you own it        -> Release ownership
//   - nobody owns it    -> Claim ownership (disabled + hint for guests)
//   - someone else owns -> a disabled, informational state
// The server is still the authority; this only reflects and requests.
export default function OwnershipButton({
  isOwner,
  hasOwner,
  isGuest,
  onClaim,
  onRelease,
}: OwnershipButtonProps) {
  if (isOwner) {
    return (
      <button
        type="button"
        className="ownership-button ownership-release"
        onClick={onRelease}
      >
        Release ownership
      </button>
    )
  }

  if (hasOwner) {
    return (
      <button type="button" className="ownership-button" disabled>
        Owned by another user
      </button>
    )
  }

  return (
    <div className="ownership-claim-wrap">
      <button
        type="button"
        className="ownership-button ownership-claim"
        onClick={onClaim}
        disabled={isGuest}
      >
        Claim ownership
      </button>
      {isGuest && (
        <p className="ownership-hint">Log in to claim this room.</p>
      )}
    </div>
  )
}
//#endregion
