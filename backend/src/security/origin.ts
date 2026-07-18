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

// Warn ONCE at import time if unconfigured — the check then fails open (allows
// all) so a misconfigured deploy degrades to "no origin check" rather than
// locking everyone out, but the operator is told.
if (ALLOWED_ORIGINS.length === 0) {
  console.warn(
    "ALLOWED_ORIGINS is empty — cross-origin checks are DISABLED. " +
      "Set ALLOWED_ORIGINS to your site origin(s) in production.",
  )
}

export function isAllowedOrigin(origin: string | undefined | null): boolean {
  // No Origin header: a non-browser client, which is not a CSRF/CSWSH vector.
  if (!origin) {
    return true
  }
  // Unconfigured: fail open (a warning was already logged).
  if (ALLOWED_ORIGINS.length === 0) {
    return true
  }
  return ALLOWED_ORIGINS.includes(origin)
}
//#endregion
