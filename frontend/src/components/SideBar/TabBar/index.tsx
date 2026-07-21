//#region Imports
import { useRef } from "react"

import { tabButtonId, tabPanelId } from "../types"
import type { TabDescriptor, TabId } from "../types"

import "./styles.css"
//#endregion

//#region Icons
// Decorative (aria-hidden in the render) — the label carries the accessible name.
// Kept here rather than in types.ts so that file stays JSX-free.
const TAB_ICONS: Record<TabId, React.ReactNode> = {
  drawing: (
    <svg viewBox="0 0 16 16">
      <path d="M12.146.146a.5.5 0 0 1 .708 0l3 3a.5.5 0 0 1 0 .708l-10 10a.5.5 0 0 1-.168.11l-5 2a.5.5 0 0 1-.65-.65l2-5a.5.5 0 0 1 .11-.168zM11.207 2.5 13.5 4.793 14.793 3.5 12.5 1.207zm1.586 3L10.5 3.207 4 9.707V10h.5a.5.5 0 0 1 .5.5v.5h.5a.5.5 0 0 1 .5.5v.5h.293zm-9.761 5.175-.106.106-1.528 3.821 3.821-1.528.106-.106A.5.5 0 0 1 5 12.5V12h-.5a.5.5 0 0 1-.5-.5V11h-.5a.5.5 0 0 1-.468-.325" />
    </svg>
  ),
  room: (
    <svg viewBox="0 0 16 16">
      <path d="M7 14s-1 0-1-1 1-4 5-4 5 3 5 4-1 1-1 1zm4-6a3 3 0 1 0 0-6 3 3 0 0 0 0 6m-5.784 6A2.24 2.24 0 0 1 5 13c0-1.355.68-2.75 1.936-3.72A6.3 6.3 0 0 0 5 9c-4 0-5 3-5 4s1 1 1 1zM4.5 8a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5" />
    </svg>
  ),
  timeline: (
    <svg viewBox="0 0 16 16">
      <path d="M8 3.5a.5.5 0 0 0-1 0V9a.5.5 0 0 0 .252.434l3.5 2a.5.5 0 0 0 .496-.868L8 8.71z" />
      <path d="M8 16A8 8 0 1 0 8 0a8 8 0 0 0 0 16m7-8A7 7 0 1 1 1 8a7 7 0 0 1 14 0" />
    </svg>
  ),
}
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

  const activeIndex = Math.max(
    0,
    tabs.findIndex((tab) => tab.id === activeTab),
  )

  return (
    <div className="tab-bar">
      <div
        ref={listRef}
        className="tab-bar-list"
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
              // so a keyboard user tabs into the bar once, then arrows between
              // tabs.
              tabIndex={isActive ? 0 : -1}
              onClick={() => onTabChange(tab.id)}
            >
              <span className="tab-bar-icon" aria-hidden="true">
                {TAB_ICONS[tab.id]}
              </span>
              <span className="tab-bar-label">{tab.label}</span>
            </button>
          )
        })}
      </div>

      {/* One underline for the whole bar that SLIDES, rather than a border that
          blinks off one tab and on to another.

          It is a flex row with a margin-offset child rather than an absolutely
          positioned bar, so the offset is ordinary layout — and it sits OUTSIDE
          the tablist, because a tablist's children should be tabs. Decorative:
          aria-selected already announces the selection. */}
      <div className="tab-bar-underline" aria-hidden="true">
        <span
          className="tab-bar-indicator"
          style={{
            width: `${100 / tabs.length}%`,
            marginInlineStart: `${(activeIndex * 100) / tabs.length}%`,
          }}
        />
      </div>
    </div>
  )
}
//#endregion
