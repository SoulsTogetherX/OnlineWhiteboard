//#region Why this exists
// Reading and writing a JSON string[] in localStorage, defensively.
//
// Two hooks need exactly this — the recent-colour history and the guest saved
// palette — and each had grown its own copy of the same try/catch + Array.isArray
// + filter(string) dance.
//
// The defensiveness is the point. localStorage can fail or lie in three ways:
// it can be blocked outright (Safari private mode throws on access), it can be
// full (quota), and its contents are user-editable, so the parsed value may be
// any shape at all. All three are handled by returning an empty list rather than
// throwing, because these are conveniences — losing a colour history must never
// break drawing.
//#endregion

//#region Helpers
export function loadStringArray(key: string): string[] {
  try {
    const raw = localStorage.getItem(key)
    const parsed = raw ? JSON.parse(raw) : []
    // Filter per-element, not just Array.isArray: hand-edited storage could hold
    // [1, null, "#ff0000"], and letting a non-string through would surface later
    // as a render crash far from the cause.
    return Array.isArray(parsed)
      ? parsed.filter((value) => typeof value === "string")
      : []
  } catch {
    return []
  }
}

export function saveStringArray(key: string, values: string[]): void {
  try {
    localStorage.setItem(key, JSON.stringify(values))
  } catch {
    /* private mode / quota — not worth surfacing for a convenience list */
  }
}
//#endregion
