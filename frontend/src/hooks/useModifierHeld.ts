//#region Imports
import { useEffect, useState } from "react"
//#endregion

//#region Hook Def
// Whether Shift — the "navigate the board" modifier — is currently held.
//
// Read from the EVENT's modifier state rather than tracked as a toggle, so it
// cannot get stuck: any key event re-reports the true state, and losing focus
// clears it. That last part matters because a shift+tab away from the window
// never delivers the keyup, and a stuck indicator would claim a mode the canvas
// is not actually in.
export default function useShiftHeld(): boolean {
  const [held, setHeld] = useState(false)

  useEffect(() => {
    const sync = (event: KeyboardEvent) => setHeld(event.shiftKey)
    const clear = () => setHeld(false)

    window.addEventListener("keydown", sync)
    window.addEventListener("keyup", sync)
    window.addEventListener("blur", clear)

    return () => {
      window.removeEventListener("keydown", sync)
      window.removeEventListener("keyup", sync)
      window.removeEventListener("blur", clear)
    }
  }, [])

  return held
}
//#endregion
