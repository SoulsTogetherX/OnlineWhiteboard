//#region Why this exists
// A browser attaches an `Origin` header identifying the page that initiated a
// request. It cannot be forged by page JavaScript, which makes it the anchor for
// two related defences:
//
//   - CSRF: a malicious site can make a logged-in victim's browser POST to our
//     API (the session cookie rides along). SameSite=Lax already blocks most of
//     this; checking Origin is defence-in-depth.
//   - CSWSH (cross-site WebSocket hijacking): SameSite does NOT reliably apply to
//     the WebSocket handshake, so without an Origin check any website could open
//     an authenticated socket AS the visitor and act under their identity. This
//     is the check's primary job.
//
// Non-browser clients (our tests, the load harness, curl) send no Origin, and
// they can't carry a victim's cookie anyway, so "no Origin" is allowed.
//#endregion

//#region Allowlist
const ALLOWED_ORIGINS = (
  process.env.ALLOWED_ORIGINS ??
  process.env.PUBLIC_SITE_URL ??
  ""
)
  .split(",")
  .map((entry) => entry.trim())
  .filter(Boolean)

// An unconfigured allowlist forces a choice between two bad options: allow
// everything (silently losing CSWSH/CSRF protection) or refuse every browser
// request (a hard outage). The right answer differs by environment, so this
// picks per environment rather than committing to one globally:
//
//   - development: fail OPEN. A fresh checkout without ALLOWED_ORIGINS set
//     should still run. There is no real session worth hijacking locally, and a
//     check that blocks local work is a check people delete.
//   - production: fail CLOSED. A security control that quietly switches itself
//     off when misconfigured is strictly worse than one that breaks loudly —
//     the silent version ships and nobody notices it's gone, the loud version
//     gets fixed before it's exposed.
//
// Note this only ever affects requests that CARRY an Origin (i.e. browsers).
// Non-browser clients are unaffected either way (see below).
const IS_PRODUCTION = process.env.NODE_ENV === "production"

// Reported ONCE at import time if unconfigured, at a severity that matches the
// consequence in this environment.
if (ALLOWED_ORIGINS.length === 0) {
  if (IS_PRODUCTION) {
    console.error(
      "FATAL-ADJACENT: ALLOWED_ORIGINS is empty in production — every " +
        "cross-origin browser request and WebSocket upgrade will be REFUSED. " +
        "Set ALLOWED_ORIGINS (or PUBLIC_SITE_URL) to your site origin(s).",
    )
  } else {
    console.warn(
      "ALLOWED_ORIGINS is empty — cross-origin checks are DISABLED in " +
        "development. Set ALLOWED_ORIGINS to your site origin(s) before " +
        "deploying; production refuses browser requests when it is unset.",
    )
  }
}

export function isAllowedOrigin(origin: string | undefined | null): boolean {
  // No Origin header: a non-browser client (our tests, the load harness, curl).
  // It cannot carry a victim's cookie, so it is not a CSRF/CSWSH vector.
  if (!origin) {
    return true
  }
  // Unconfigured: open in development, closed in production. See above.
  if (ALLOWED_ORIGINS.length === 0) {
    return !IS_PRODUCTION
  }
  return ALLOWED_ORIGINS.includes(origin)
}
//#endregion
