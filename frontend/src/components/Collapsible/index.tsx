//#region Imports
import { useSessionStorage } from "@/hooks/useSessionStorage"

import "./styles.css"
//#endregion

//#region Component Def
export interface CollapsibleProps {
  title: string
  // Stable key for remembering open/closed across tab switches and reloads.
  // Session-scoped, matching the rest of the per-tab UI state.
  storageKey: string
  defaultOpen?: boolean
  // Short right-aligned summary — a count, a state — so a folded section still
  // says something. Without it, collapsing hides the very fact that there is
  // anything in there.
  badge?: string
  children: React.ReactNode
}

// A titled, foldable group of controls.
//
// Built on <details>/<summary> rather than a div and a boolean, because the
// browser already gives that pair the disclosure semantics: it is a button to a
// screen reader, it toggles on Enter and Space, it is in the tab order, and
// Ctrl-F on a closed section scrolls it open in Chromium. Re-implementing that
// with onClick and aria-expanded is more code that behaves slightly worse.
//
// The open state is CONTROLLED off session storage rather than left to the
// element, so folding a section is remembered — the alternative is every section
// springing back open each time you leave the tab, which trains you to ignore
// them.
export default function Collapsible({
  title,
  storageKey,
  defaultOpen = false,
  badge,
  children,
}: CollapsibleProps) {
  const [open, setOpen] = useSessionStorage<boolean>(storageKey, defaultOpen)

  return (
    <details
      className="collapsible"
      open={open}
      // onToggle rather than onClick: it fires for every way the element can
      // open, including the keyboard and find-in-page, so the stored state can
      // never drift from what is actually on screen.
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary className="collapsible-summary">
        <span className="collapsible-title">{title}</span>
        {badge !== undefined && (
          <span className="collapsible-badge">{badge}</span>
        )}
        <svg
          className="collapsible-chevron"
          viewBox="0 0 16 16"
          aria-hidden="true"
        >
          <path d="M4.5 6.5 8 10l3.5-3.5" />
        </svg>
      </summary>
      <div className="collapsible-body">{children}</div>
    </details>
  )
}
//#endregion
