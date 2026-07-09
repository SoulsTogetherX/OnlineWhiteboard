//#region Imports
import { useState } from "react"

import PopupBase from "@/components/Popups/PopupBase"

import "./styles.css"
//#endregion

//#region Component
export interface RoomPopupProps {
  isOpen: boolean
  roomId: string
  onClose: () => void
  onLoad: (roomId: string) => void
}

export default function RoomPopup({
  isOpen,
  roomId,
  onClose,
  onLoad,
}: RoomPopupProps) {
  const [draftRoomId, setDraftRoomId] = useState<string>(roomId)

  return (
    <PopupBase isOpen={isOpen} onClose={onClose}>
      <div className="room-popup">
        <div>
          Room Id:
          <input
            name="room-id"
            value={draftRoomId}
            onChange={(ev) => setDraftRoomId(ev.target.value)}
            maxLength={22}
          />
        </div>
        <button onClick={() => onLoad(draftRoomId)}>Load</button>
      </div>
    </PopupBase>
  )
}
//#endregion
