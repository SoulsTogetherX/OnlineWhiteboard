//#region Imports
import { useRef } from "react"

import { tabButtonId, tabPanelId } from "../types"
import type { TabDescriptor, TabId } from "../types"

import "./styles.css"
//#endregion

//#region Component Def
export interface TabBarProps {
  tabs: TabDescriptor[]
  activeTab: TabId
  onTabChange: (tab: TabId) => void
}

// Presentational. Renders the WAI-ARIA tabs pattern: a `tablist` of `tab`
// buttons using roving tabindex (only the active tab is tabbable) with
// Left/Right/Home/End moving selection, so the whole bar is one Tab stop and
// arrows step between tabs. A focusable control that ignored the keyboard would
// be worse than a plain div (§12.9), so the keyboard handling ships with the
// roles rather than being deferred.
export default function TabBar({ tabs, activeTab, onTabChange }: TabBarProps) {
  const listRef = useRef<HTMLDivElement>(null)

  const focusTab = (tab: TabId) => {
    onTabChange(tab)
    // Move DOM focus to the newly selected tab so arrow-stepping keeps the
    // focused and selected tab in sync (the roving-tabindex contract).
    listRef.current
      ?.querySelector<HTMLButtonElement>(`#${CSS.escape(tabButtonId(tab))}`)
      ?.focus()
  }

  const onKeyDown = (event: React.KeyboardEvent) => {
    const index = tabs.findIndex((tab) => tab.id === activeTab)
    if (index < 0) {
      return
    }
    let nextIndex: number | null = null
    switch (event.key) {
      case "ArrowRight":
        nextIndex = (index + 1) % tabs.length
        break
      case "ArrowLeft":
        nextIndex = (index - 1 + tabs.length) % tabs.length
        break
      case "Home":
        nextIndex = 0
        break
      case "End":
        nextIndex = tabs.length - 1
        break
    }
    if (nextIndex !== null) {
      event.preventDefault()
      focusTab(tabs[nextIndex].id)
    }
  }

  return (
    <div
      ref={listRef}
      className="tab-bar"
      role="tablist"
      aria-label="Sidebar sections"
      onKeyDown={onKeyDown}
    >
      {tabs.map((tab) => {
        const isActive = tab.id === activeTab
        return (
          <button
            key={tab.id}
            id={tabButtonId(tab.id)}
            type="button"
            role="tab"
            className={`tab-bar-button${isActive ? " tab-bar-button-active" : ""}`}
            aria-selected={isActive}
            aria-controls={tabPanelId(tab.id)}
            // Roving tabindex: the inactive tabs are removed from the Tab order
            // so a keyboard user tabs into the bar once, then arrows between tabs.
            tabIndex={isActive ? 0 : -1}
            onClick={() => onTabChange(tab.id)}
          >
            {tab.label}
          </button>
        )
      })}
    </div>
  )
}
//#endregion
