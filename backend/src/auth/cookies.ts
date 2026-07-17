//#region Cookie parsing
// A tiny, dependency-free cookie-header parser. The app sets and reads exactly
// one cookie (the session id), so pulling in cookie-parser middleware would be
// more surface than it's worth. Crucially this works on a raw Node
// IncomingMessage too, which is what the WebSocket upgrade handler has (there is
// no Express `req` at that point) — that's why it lives here rather than being
// Express-specific.
//#endregion

export const SESSION_COOKIE = "sid"

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
