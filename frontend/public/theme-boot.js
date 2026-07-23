// Applies the saved theme BEFORE the first paint.
//
// Why this file exists at all, rather than living in the React app: the app's
// entry is `<script type="module">`, which is deferred by definition — it runs
// after the document is parsed, which is after the browser has already painted.
// useTheme then stamps `data-theme` in an effect, later still. So a dark-mode
// user saw one frame of the light palette on every single load. Nothing about
// that is a race we can win from inside React; the fix has to happen earlier
// than React exists.
//
// Why a separate file rather than an inline <script>: the production CSP is
// `script-src 'self'` (frontend/security-headers.conf), which blocks inline
// script. An inline version would work perfectly in dev and be silently dropped
// in prod — the worst kind of difference, because the symptom only appears where
// you are least able to debug it. A same-origin file is allowed by 'self' as it
// stands, with no CSP hash to recompute every time this text changes.
//
// Loaded WITHOUT defer/async/module in <head>, so it is a blocking script: the
// browser runs it before it builds the body, and therefore before it paints.
// Keep it small — it is on the critical path for the first frame.
;(function () {
  // Duplicated from useTheme.ts on purpose: a classic blocking script cannot
  // import from a module without becoming one, and becoming one would defer it,
  // which is the entire bug. Both sides carry a comment pointing at the other.
  var KEY = "online-whiteboard-theme"

  var theme = null
  try {
    var stored = localStorage.getItem(KEY)
    if (stored === "light" || stored === "dark") {
      theme = stored
    }
  } catch (e) {
    // localStorage throws in private mode / blocked-cookie settings. Falling
    // through to the OS preference is strictly better than failing to paint.
  }

  if (theme === null) {
    theme =
      window.matchMedia &&
      window.matchMedia("(prefers-color-scheme: dark)").matches
        ? "dark"
        : "light"
  }

  // The same attribute the CSS variables key off, so the very first paint uses
  // the right palette. useTheme reads this back rather than recomputing, which
  // keeps the two from ever disagreeing about what "current" means.
  document.documentElement.setAttribute("data-theme", theme)
})()
