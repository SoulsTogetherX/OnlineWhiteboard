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

  // Guest FIRST, before the has-owner check: a guest can neither claim nor
  // manage regardless of whether the room is owned, so "Owned by another user"
  // was misleading (and showed even when the guest is really this same person
  // logged in on another tab). The honest state for a guest is "log in".
  if (isGuest) {
    return (
      <div className="ownership-claim-wrap">
        <button type="button" className="ownership-button ownership-claim" disabled>
          Claim ownership
        </button>
        <p className="ownership-hint">Log in to claim or manage this room.</p>
      </div>
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
    <button
      type="button"
      className="ownership-button ownership-claim"
      onClick={onClaim}
    >
      Claim ownership
    </button>
  )
}
//#endregion
