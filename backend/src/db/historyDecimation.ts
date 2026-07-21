//#region Why this exists
// Uniform history decimation. Once a room's retained event log exceeds its cap
// (MAX_HISTORY_EVENTS), we thin it so storage stays bounded AND the timeline
// stays scrubbable start-to-end. The choice (CLAUDE.md §16) is UNIFORM thinning —
// evenly spaced across the WHOLE span, not "keep the ends sharp and thin the
// middle" — so the timeline keeps even fidelity everywhere. The accepted cost is
// that recent history is thinned too.
//
// This is pure and touches no I/O, so it lives here with a unit test that runs in
// the pre-commit gate (no database needed). The server is the only decimator; the
// client just receives fewer steps, so there is nothing here the client must
// agree on — it is backend-only, not shared/.
//#endregion

//#region Selector
// Given the ascending list of retained event revisions and the cap, return the
// revisions to KEEP: identity when already within the cap, otherwise `cap`
// evenly-spaced samples with the FIRST and LAST always kept (the scrub endpoints
// must stay crisp). Deterministic — the same input always yields the same
// survivors, so re-running a save that failed mid-flight decimates identically.
export function selectDecimatedSurvivors(
  revisions: number[],
  cap: number,
): number[] {
  const count = revisions.length
  if (cap < 1) {
    return []
  }
  if (count <= cap) {
    return revisions.slice()
  }
  if (cap === 1) {
    // Degenerate; keep the most recent so the head is represented.
    return [revisions[count - 1]]
  }

  // Sample `cap` indices evenly across [0, count-1], anchoring both ends:
  //   index(i) = round(i * (count-1) / (cap-1))   for i in 0..cap-1
  // so index(0) = 0 and index(cap-1) = count-1. Rounding can land two
  // consecutive samples on the same index only when cap is close to count; the
  // dedupe keeps the result strictly ascending (and ≤ cap).
  const survivors: number[] = []
  let previousIndex = -1
  for (let i = 0; i < cap; i += 1) {
    const index = Math.round((i * (count - 1)) / (cap - 1))
    if (index !== previousIndex) {
      survivors.push(revisions[index])
      previousIndex = index
    }
  }
  return survivors
}
//#endregion
