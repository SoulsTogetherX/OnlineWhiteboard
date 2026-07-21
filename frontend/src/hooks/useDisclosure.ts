//#region Imports
import { useCallback, useMemo, useState } from "react"
//#endregion

//#region Type Def
export interface UseDisclosureResult {
  isOpen: boolean
  open: () => void
  close: () => void
  toggle: () => void
}
//#endregion

//#region Hook Def
// A single open/closed flag with stable open/close/toggle callbacks. The floating
// popups App still owns (room picker, members, dashboard, auth) are each one of
// these, so App reads as `const members = useDisclosure()` instead of a bare
// `useState(false)` pair repeated four times.
export default function useDisclosure(
  initialOpen = false,
): UseDisclosureResult {
  const [isOpen, setIsOpen] = useState<boolean>(initialOpen)

  const open = useCallback(() => setIsOpen(true), [])
  const close = useCallback(() => setIsOpen(false), [])
  const toggle = useCallback(() => setIsOpen((prev) => !prev), [])

  return useMemo(
    () => ({ isOpen, open, close, toggle }),
    [isOpen, open, close, toggle],
  )
}
//#endregion
