//#region Imports
import type { ReactNode } from "react"

import TabBar from "./TabBar"
import { SIDEBAR_TABS, tabButtonId, tabPanelId } from "./types"
import type { TabId } from "./types"

import "./styles.css"
//#endregion

//#region Re-exports
export { SIDEBAR_TABS } from "./types"
export type { TabId, TabDescriptor } from "./types"
//#endregion

//#region Component Def
export interface SideBarProps {
  isOpen: boolean
  onToggle: () => void
  activeTab: TabId
  onTabChange: (tab: TabId) => void
  // The active tab's panel content, rendered by the composition root. The shell
  // stays ignorant of what a tab contains — it only frames it — so each tab can
  // grow independently without touching this file.
  children: ReactNode
}

// The retractable right sidebar shell. Presentational: it owns layout and the
// open/closed transition, but not tab content or the open state itself (App
// holds those). Retractable on desktop and mobile via a single `isOpen` prop;
// the edge handle stays operable while closed so there is always a way back in.
export default function SideBar({
  isOpen,
  onToggle,
  activeTab,
  onTabChange,
  children,
}: SideBarProps) {
  return (
    <aside
      className={`sidebar${isOpen ? " sidebar-open" : ""}`}
      aria-label="Whiteboard controls"
    >
      <button
        type="button"
        className="sidebar-handle"
        onClick={onToggle}
        aria-label={isOpen ? "Collapse sidebar" : "Expand sidebar"}
        aria-expanded={isOpen}
        // Points at the region the handle shows/hides so assistive tech ties the
        // two together.
        aria-controls="sidebar-body"
      >
        {/* Decorative chevron; it flips with the open state via CSS. The label
            above carries the meaning. */}
        <span className="sidebar-handle-chevron" aria-hidden="true" />
      </button>

      <div
        id="sidebar-body"
        className="sidebar-body"
        // When collapsed the panel is only translated off-screen, so without
        // `inert` its controls stay focusable and in the accessibility tree —
        // the same trap ToolMenu had. `inert` removes the whole body from both.
        inert={!isOpen}
      >
        <TabBar
          tabs={SIDEBAR_TABS}
          activeTab={activeTab}
          onTabChange={onTabChange}
        />
        <div
          className="sidebar-panel"
          role="tabpanel"
          id={tabPanelId(activeTab)}
          aria-labelledby={tabButtonId(activeTab)}
          // A tabpanel with no natively focusable child must itself be focusable
          // so keyboard users can reach the panel content after the tabs.
          tabIndex={0}
        >
          {children}
        </div>
      </div>
    </aside>
  )
}
//#endregion
