//#region Imports
import "./styles.css"
//#endregion

//#region Component Def
export interface RoomStatusProps {
  activeUsers: number
  roomId: string
  socketLabel: string
}

export default function RoomStatus({
  activeUsers,
  roomId,
  socketLabel,
}: RoomStatusProps) {
  return (
    <div className="room-status" aria-live="polite">
      <span>Room: {roomId}</span>
      <span>{activeUsers} active</span>
      <span>{socketLabel}</span>
    </div>
  )
}
//#endregion
