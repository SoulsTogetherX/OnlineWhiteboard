//#region Why this exists
// The single most instructive breach for an app like this one is 23andMe (2023).
// It was not broken into. Roughly 14,000 accounts fell to CREDENTIAL STUFFING —
// passwords reused from other sites' leaks — and through a data-sharing feature
// that cascaded to about 5.5 million profiles. Their own strongest password
// policy would not have helped, because the passwords were not weak. They were
// correct passwords, belonging to the user, already public somewhere else.
//
// The only control that stops that class of attack at registration is checking
// the password against a corpus of known-breached credentials. NIST SP 800-63B
// requires exactly this, and it is what 23andMe did not do.
//
// HOW THIS AVOIDS SENDING THE PASSWORD ANYWHERE (k-anonymity):
//   1. SHA-1 the password locally.
//   2. Send only the FIRST FIVE hex characters of that hash.
//   3. HIBP returns every suffix it knows beginning with that prefix — hundreds
//      of them — and the comparison happens here.
// The service therefore learns a 5-character bucket shared by many thousands of
// distinct passwords, and never learns the password, its full hash, or which
// suffix we were interested in.
//
// SHA-1 is correct here and is NOT a weakness: it is the index format of the
// corpus, not a security boundary. The password is still stored with scrypt.
//
// FAIL OPEN, DELIBERATELY: if HIBP is slow or down, registration proceeds. An
// outage of a third party must not become an outage of sign-up. The failure mode
// of fail-closed here is worse than the risk of briefly not screening.
//#endregion

//#region Imports
import { createHash } from "node:crypto"
//#endregion

//#region Constants
const HIBP_RANGE_URL = "https://api.pwnedpasswords.com/range"

// Short on purpose. This sits in the registration request path, so a slow
// third party directly becomes slow sign-up. Two seconds is generous for a CDN
// endpoint and still bounded.
const TIMEOUT_MS = 2000

// Opt-out for offline development and for tests, which must never depend on a
// network call. Set BREACH_CHECK_DISABLED=1 to skip.
function isDisabled(): boolean {
  return process.env.BREACH_CHECK_DISABLED === "1"
}
//#endregion

//#region Check
export type BreachCheck =
  | { breached: true; count: number }
  | { breached: false }
  // Distinguished from "not breached" on purpose: the caller may want to log
  // that screening did not actually happen, rather than record a clean result
  // that was never really checked.
  | { breached: false; skipped: true; reason: string }

export async function checkPasswordBreached(
  password: string,
): Promise<BreachCheck> {
  if (isDisabled()) {
    return { breached: false, skipped: true, reason: "disabled" }
  }

  const hash = createHash("sha1").update(password).digest("hex").toUpperCase()
  const prefix = hash.slice(0, 5)
  const suffix = hash.slice(5)

  try {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)

    let response: Response
    try {
      response = await fetch(`${HIBP_RANGE_URL}/${prefix}`, {
        signal: controller.signal,
        headers: {
          // Asks HIBP to pad the response with random entries, so an observer
          // cannot infer anything from its SIZE. Costs nothing to request.
          "Add-Padding": "true",
          "User-Agent": "OnlineWhiteboard-PasswordCheck",
        },
      })
    } finally {
      clearTimeout(timer)
    }

    if (!response.ok) {
      return {
        breached: false,
        skipped: true,
        reason: `hibp status ${response.status}`,
      }
    }

    const body = await response.text()
    for (const line of body.split("\n")) {
      // Lines are "SUFFIX:count". Padding entries have a count of 0 and are
      // ignored by the same parse.
      const sep = line.indexOf(":")
      if (sep === -1) {
        continue
      }
      if (line.slice(0, sep).trim().toUpperCase() !== suffix) {
        continue
      }
      const count = Number.parseInt(line.slice(sep + 1).trim(), 10)
      if (Number.isFinite(count) && count > 0) {
        return { breached: true, count }
      }
    }

    return { breached: false }
  } catch (error) {
    // Network failure, abort, DNS — all mean "we could not check", never
    // "the password is fine".
    const message = error instanceof Error ? error.message : "unknown"
    return { breached: false, skipped: true, reason: message }
  }
}
//#endregion
