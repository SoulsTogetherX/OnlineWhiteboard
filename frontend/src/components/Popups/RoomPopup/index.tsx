//#region Imports
import { useId, useState } from "react"

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
  const inputId = useId()
  const [draftRoomId, setDraftRoomId] = useState<string>(roomId)

  // `useState(roomId)` only seeds at mount, and PopupBase never unmounts its
  // children — so this input kept whatever it was first given and never tracked
  // the real room again. Re-seeding when the popup opens fixes that, and
  // implements the README's "Set the Room ID prompt to match the current room by
  // default". It also discards a half-typed draft left over from a cancel.
  //
  // Adjusted DURING RENDER rather than in an effect. This is React's documented
  // pattern for resetting state when a prop changes: React discards this render
  // and immediately re-runs the component with the new state, before touching
  // the DOM. An effect would commit the stale value, paint it, then correct it
  // — a visible flash of the wrong room id.
  const [wasOpen, setWasOpen] = useState<boolean>(isOpen)
  if (isOpen !== wasOpen) {
    setWasOpen(isOpen)
    if (isOpen) {
      setDraftRoomId(roomId)
    }
  }

  const submit = () => onLoad(draftRoomId)

  return (
    <PopupBase isOpen={isOpen} onClose={onClose} label="Change room">
      {/* A real <form> so Enter submits. Previously the only way to confirm was
          to click "Load" — a keyboard user had to tab to the button. */}
      <form
        className="room-popup"
        onSubmit={(event) => {
          event.preventDefault()
          submit()
        }}
      >
        <div>
          {/* Was bare text in a <div>: not associated with the input, so screen
              readers announced an unnamed text field. `name` does not provide
              an accessible name; htmlFor/id does. */}
          <label htmlFor={inputId}>Room Id:</label>
          <input
            id={inputId}
            name="room-id"
            type="text"
            value={draftRoomId}
            onChange={(ev) => setDraftRoomId(ev.target.value)}
            maxLength={22}
            autoComplete="off"
          />
        </div>
        <button type="submit">Load</button>
      </form>
    </PopupBase>
  )
}
//#endregion
