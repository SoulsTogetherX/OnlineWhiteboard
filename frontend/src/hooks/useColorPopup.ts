//#region Imports
import { useCallback, useState } from "react"

import useDisclosure from "@/hooks/useDisclosure"

import type { ColorPaletteKeys } from "@shared/types/primitive"
//#endregion

//#region Type Def
export interface UseColorPopupResult {
  isOpen: boolean
  // Which swatch the picker is editing — "primary" or "secondary".
  target: ColorPaletteKeys
  // Opens the picker on the primary (true) or secondary (false) swatch.
  open: (primary: boolean) => void
  close: () => void
}
//#endregion

//#region Hook Def
// The colour picker's open/target state, lifted out of App. Only the popup's UI
// state lives here; the palette itself (and recent/saved colours) stay in their
// own hooks — this just tracks whether the picker is open and which swatch it
// edits, so `currentColor` and `onApply` in App read the right one. Opening the
// secondary swatch used to show the primary's channels (target was hardcoded).
export default function useColorPopup(): UseColorPopupResult {
  const { isOpen, open: openPopup, close } = useDisclosure()
  const [target, setTarget] = useState<ColorPaletteKeys>("primary")

  const open = useCallback(
    (primary: boolean) => {
      setTarget(primary ? "primary" : "secondary")
      openPopup()
    },
    [openPopup],
  )

  return { isOpen, target, open, close }
}
//#endregion
