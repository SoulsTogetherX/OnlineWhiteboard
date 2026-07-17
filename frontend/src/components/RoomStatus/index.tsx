//#region Imports
import "./styles.css"
//#endregion

//#region Component Def
export interface RoomStatusProps {
  roomId: string
  socketLabel: string
}

export default function RoomStatus({ roomId, socketLabel }: RoomStatusProps) {
  return (
    <div className="room-status" aria-live="polite">
      <span>Room: {roomId}</span>
      <span>{socketLabel}</span>
    </div>
  )
}
//#endregion
