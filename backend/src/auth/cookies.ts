//#region Cookie parsing
// A tiny, dependency-free cookie-header parser. The app sets and reads exactly
// one cookie (the session id), so pulling in cookie-parser middleware would be
// more surface than it's worth. Crucially this works on a raw Node
// IncomingMessage too, which is what the WebSocket upgrade handler has (there is
// no Express `req` at that point) — that's why it lives here rather than being
// Express-specific.
//#endregion

// The `__Host-` prefix is a browser-enforced hardening: a cookie with this
// prefix is only accepted if it is Secure, has Path=/, and has NO Domain — which
// pins it to exactly this host and blocks a subdomain from setting or
// overwriting it. It REQUIRES Secure, so it can only be used over HTTPS; in dev
// (plain HTTP) the browser would reject it, so we use the bare name there.
export const SESSION_COOKIE =
  process.env.NODE_ENV === "production" ? "__Host-sid" : "sid"

export function parseCookies(
  header: string | undefined,
): Record<string, string> {
  const out: Record<string, string> = {}
  if (!header) {
    return out
  }

  for (const part of header.split(";")) {
    const eq = part.indexOf("=")
    if (eq === -1) {
      continue
    }
    const name = part.slice(0, eq).trim()
    if (!name) {
      continue
    }
    out[name] = decodeURIComponent(part.slice(eq + 1).trim())
  }
  return out
}
