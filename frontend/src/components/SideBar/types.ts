//#region Types
// The three sidebar tabs. The timeline used to be one of these; it now lives
// inside the Room tab, because a room's history belongs to the room, and this
// slot holds the account instead.
//
// Original note: Kept as a shared union so the shell, the TabBar and
// the composition root in App all name a tab with the same string — a mistyped
// "timline" is then a compile error at every site, not a tab that silently never
// renders (§12.8: one concept, one name).
export type TabId = "drawing" | "room" | "account"

export interface TabDescriptor {
  id: TabId
  label: string
}

// The canonical tab order, shared by the TabBar (which renders the buttons) and
// App (which picks the panel). Defined once so the two can never disagree on
// which tabs exist or in what order.
export const SIDEBAR_TABS: TabDescriptor[] = [
  { id: "drawing", label: "Drawing" },
  { id: "room", label: "Room" },
  { id: "account", label: "Account" },
]

// Each panel is identified so its tab can point at it with aria-controls and the
// panel back at the tab with aria-labelledby. Derived from the tab id so the two
// halves can never drift. Live here rather than in the component file so the
// react-refresh rule (component files export only components) is satisfied and
// both TabBar and the shell import the same pair.
export const tabButtonId = (tab: TabId) => `sidebar-tab-${tab}`
export const tabPanelId = (tab: TabId) => `sidebar-panel-${tab}`
//#endregion
