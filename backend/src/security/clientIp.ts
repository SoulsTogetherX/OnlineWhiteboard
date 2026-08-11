//#region Imports
import type { IncomingMessage } from "http"
//#endregion

//#region Trusted client-IP header
// Which request header carries the real client address depends on what sits in
// front of the backend, so the header NAME is configuration, not code:
//
//   * compose prod stack — our own nginx sets X-Real-IP (nginx.conf.template),
//     and the backend publishes no host port, so nothing external can forge it.
//     That is the default here, which keeps both Docker stacks working with no
//     new env vars.
//   * single-container PaaS (Render etc.) — there is no nginx, and the
//     platform's edge proxy sets its own header instead. On Render that is
//     True-Client-IP (set by the Cloudflare layer in front of every service,
//     overwriting anything the client sent). Set
//     TRUSTED_CLIENT_IP_HEADER=true-client-ip there.
//
// Only ever set this to a header the platform in front of the backend
// OVERWRITES on every request. Naming a header the platform passes through
// verbatim hands every client a free "pick your own IP" — which defeats the
// per-IP rate limits and socket caps this value feeds, the exact bypass
// documented in socketLimits.ts.
//
// Read once at import, like every other env-derived constant in this codebase:
// configuration is fixed for the life of the process.
const TRUSTED_CLIENT_IP_HEADER = (
  process.env.TRUSTED_CLIENT_IP_HEADER || "x-real-ip"
).toLowerCase()
//#endregion

//#region Client IP resolution
// Shared by the HTTP rate limiter (rateLimit.ts) and the WebSocket connection
// caps (socketLimits.ts) so the two can never disagree about who a client is.
// Express's Request extends IncomingMessage, so one signature serves both.
//
// When the header is absent (local dev hits the backend directly, or a
// misconfigured deploy) this falls back to the socket peer address. Behind a
// proxy that fallback collapses every client into the proxy's own IP — blunt,
// but fail-CLOSED for abuse limits: strangers share one bucket rather than
// each minting private ones.
export function clientAddressOf(request: IncomingMessage): string {
  const header = request.headers[TRUSTED_CLIENT_IP_HEADER]
  if (typeof header === "string" && header.length > 0) {
    return header
  }
  return request.socket.remoteAddress ?? "unknown"
}
//#endregion
