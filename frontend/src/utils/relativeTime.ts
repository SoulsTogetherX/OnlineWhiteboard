//#region Helper Def
// "3 minutes ago" style relative time from an ISO timestamp. One shared copy —
// the Dashboard's room cards and the Timeline's checkpoint list each carried
// their own before (§12.9: a duplicated helper belongs in one place the second
// time it appears). The granular cascade (seconds → years) is kept from the
// Dashboard version so an old room's "3 months ago" still reads correctly;
// unifying it just means a checkpoint now reads "5 minutes ago" instead of the
// old compact "5m ago". Returns "" for an unparseable timestamp.
export function relativeTime(iso: string): string {
  const then = new Date(iso).getTime()
  if (Number.isNaN(then)) {
    return ""
  }
  const seconds = Math.max(0, Math.round((Date.now() - then) / 1000))
  const units: [number, string][] = [
    [60, "second"],
    [60, "minute"],
    [24, "hour"],
    [7, "day"],
    [4.35, "week"],
    [12, "month"],
    [Number.POSITIVE_INFINITY, "year"],
  ]
  let value = seconds
  for (const [size, name] of units) {
    if (value < size) {
      const rounded = Math.round(value)
      return `${rounded} ${name}${rounded === 1 ? "" : "s"} ago`
    }
    value /= size
  }
  return ""
}
//#endregion
