//#region Imports
import "./styles.css"
//#endregion

//#region Component Def
export interface RoomStatusProps {
  roomId: string
  socketLabel: string
  // Opens the change-room picker. The room id is the trigger — it used to live
  // on the (now removed) toolbar's room button, and this is its natural home.
  onOpenRoomPicker: () => void
}

export default function RoomStatus({
  roomId,
  socketLabel,
  onOpenRoomPicker,
}: RoomStatusProps) {
  return (
    <div className="room-status" aria-live="polite">
      <button
        type="button"
        className="room-status-room"
        onClick={onOpenRoomPicker}
        aria-label={`Room: ${roomId}. Change room.`}
      >
        Room: {roomId}
      </button>
      <span>{socketLabel}</span>
    </div>
  )
}
//#endregion
