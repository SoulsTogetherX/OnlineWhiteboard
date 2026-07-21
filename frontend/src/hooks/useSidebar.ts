//#region Imports
import { useCallback, useState } from "react"

import useMediaQuery from "@/hooks/useMediaQuery"

import { DESKTOP_MEDIA_QUERY } from "@/constants/ui"

import type { TabId } from "@/components/SideBar"
//#endregion

//#region Type Def
export interface UseSidebarResult {
  isOpen: boolean
  toggle: () => void
  activeTab: TabId
  setActiveTab: (tab: TabId) => void
}
//#endregion

//#region Hook Def
// The retractable right sidebar's open/collapsed flag and active tab. It starts
// open on desktop and collapsed on a phone so a phone-sized canvas isn't covered
// on load — `isDesktop` is read synchronously (useMediaQuery reads during render),
// so the initial open state is correct on the very first render.
export default function useSidebar(
  initialTab: TabId = "drawing",
): UseSidebarResult {
  const isDesktop = useMediaQuery(DESKTOP_MEDIA_QUERY)
  const [isOpen, setIsOpen] = useState<boolean>(isDesktop)
  const [activeTab, setActiveTab] = useState<TabId>(initialTab)

  const toggle = useCallback(() => setIsOpen((open) => !open), [])

  return { isOpen, toggle, activeTab, setActiveTab }
}
//#endregion
