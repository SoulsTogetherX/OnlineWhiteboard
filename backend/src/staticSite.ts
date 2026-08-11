//#region Why this exists
// The frontend always talks to a RELATIVE /api and /ws — whatever origin serves
// the page must also answer those paths. In the compose prod stack that origin
// is nginx, which serves the bundle and proxies to this backend. On a
// single-container host (Render's free tier and friends) there is no nginx, so
// the backend itself must be able to play the nginx role: serve the built
// frontend and answer /api + /ws on the same origin.
//
// Gated on STATIC_DIR so it is a NO-OP in both Docker stacks and in dev —
// nothing sets the variable there, and nginx/Vite keep doing their jobs. Only
// Dockerfile.render sets it.
//
// The nginx behaviours worth keeping are mirrored deliberately
// (nginx.conf.template is the reference):
//   * /assets/ is content-hashed, so it is cached forever;
//   * index.html is the ONLY un-hashed entry point, so it is never cached —
//     a cached copy would pin a user to an old bundle forever;
//   * unknown paths fall back to index.html (SPA routing);
//   * the security headers from security-headers.conf ride on every response.
//#endregion

//#region Imports
import express, { type Express, type Response } from "express"
import path from "path"
//#endregion

//#region Security headers
// Mirrors frontend/security-headers.conf — see that file for the reasoning
// behind each value (in particular why style-src needs 'unsafe-inline'). If you
// change one, change both.
function setSecurityHeaders(res: Response): void {
  res.setHeader("X-Content-Type-Options", "nosniff")
  res.setHeader("X-Frame-Options", "DENY")
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin")
  // Only honoured over HTTPS; inert on plain HTTP.
  res.setHeader(
    "Strict-Transport-Security",
    "max-age=31536000; includeSubDomains",
  )
  res.setHeader(
    "Content-Security-Policy",
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; " +
      "img-src 'self' data:; font-src 'self'; connect-src 'self'; " +
      "object-src 'none'; base-uri 'self'; form-action 'self'; " +
      "frame-ancestors 'none'",
  )
}
//#endregion

//#region Configure
export default function configureStaticSite(app: Express): void {
  const dir = process.env.STATIC_DIR
  if (!dir) {
    return
  }
  const root = path.resolve(dir)

  // index: false — index.html must NOT be served by the static handler, whose
  // default caching would apply. It goes through the fallback below instead,
  // where its no-cache header is explicit.
  app.use(
    express.static(root, {
      index: false,
      setHeaders: (res, filePath) => {
        setSecurityHeaders(res)
        // Vite content-hashes every file under assets/, so a given URL's bytes
        // can never change — the only thing that makes "cache forever" safe.
        if (filePath.startsWith(path.join(root, "assets") + path.sep)) {
          res.setHeader("Cache-Control", "public, max-age=31536000, immutable")
        }
      },
    }),
  )

  // SPA fallback, registered AFTER the API routes so it can never shadow them.
  // Unknown /api paths must still 404 rather than receive HTML, and /ws is
  // excluded for the same reason (it is normally consumed by the upgrade
  // handler and never reaches Express at all).
  app.use((req, res, next) => {
    if (req.method !== "GET" && req.method !== "HEAD") {
      return next()
    }
    if (req.path.startsWith("/api") || req.path.startsWith("/ws")) {
      return next()
    }
    setSecurityHeaders(res)
    res.setHeader("Cache-Control", "no-cache")
    // cacheControl: false — otherwise sendFile writes its own Cache-Control
    // (public, max-age=0) over the explicit no-cache above.
    res.sendFile("index.html", { root, cacheControl: false }, (err) => {
      if (err) {
        next(err)
      }
    })
  })
}
//#endregion
