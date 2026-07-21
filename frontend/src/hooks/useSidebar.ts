//#region Imports
import { useCallback } from "react"

import useMediaQuery from "@/hooks/useMediaQuery"
import { useSessionStorage } from "@/hooks/useSessionStorage"

import { DESKTOP_MEDIA_QUERY } from "@/constants/ui"

import type { TabId } from "@/components/SideBar"
//#endregion

//#region Constants
// Persisted so a page refresh keeps the sidebar exactly as it was — same tab
// open, or collapsed if it was collapsed. sessionStorage (per-tab), not local,
// so two tabs don't fight over one sidebar state.
const SIDEBAR_OPEN_KEY = "online-whiteboard-sidebar-open"
const SIDEBAR_TAB_KEY = "online-whiteboard-sidebar-tab"
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
// The retractable right sidebar's open/collapsed flag and active tab, persisted
// across refreshes. On the FIRST visit (nothing stored) it defaults to open on
// desktop and collapsed on a phone so a phone-sized canvas isn't covered on load
// — `isDesktop` is read synchronously (useMediaQuery reads during render), so the
// initial state is correct on the very first render.
export default function useSidebar(
  initialTab: TabId = "drawing",
): UseSidebarResult {
  const isDesktop = useMediaQuery(DESKTOP_MEDIA_QUERY)
  const [isOpen, setIsOpen] = useSessionStorage<boolean>(
    SIDEBAR_OPEN_KEY,
    isDesktop,
    true,
  )
  const [activeTab, setActiveTab] = useSessionStorage<TabId>(
    SIDEBAR_TAB_KEY,
    initialTab,
  )

  const toggle = useCallback(() => setIsOpen(!isOpen), [isOpen, setIsOpen])

  return { isOpen, toggle, activeTab, setActiveTab }
}
//#endregion
