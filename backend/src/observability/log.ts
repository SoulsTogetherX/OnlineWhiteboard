//#region Why this exists
// Structured logging: one JSON object per line, machine-parseable, with bound
// context fields instead of values interpolated into prose. The difference
// matters the day something breaks in production: `docker logs | grep` (or
// Render's log search) can filter `"roomId":"abc"` exactly, whereas prose like
// `Failed to flush events for room abc:` needs a regex per call site and
// silently misses the sites that phrased it differently.
//
// Hand-rolled rather than pino/winston, deliberately. The whole requirement is
// "JSON.stringify a merged object and write it to the right stream" — ~40 lines
// below. A logging dependency earns its keep at high throughput (async
// transports, reusable serializers); this backend logs on lifecycle events and
// errors, not per message, so the dependency would be surface area without
// payoff. The one performance rule that matters here is inherited from the call
// sites: nothing on the per-draw-message hot path logs.
//
// PRIVACY RULE for every call site: never log a raw email, session token,
// password, or client IP. Log the derived identifiers the code already uses
// (sessionHash, connectionId, roomId) — they correlate a story without
// containing a secret. This mirrors how emails are handled at rest
// (auth/emailCrypto.ts): the plaintext never touches a place that persists.
// One documented exception: the connection-cap warning (sockets/index.ts) logs
// its limiting key, which can be a client IP, because blocking sustained abuse
// upstream requires knowing the address.
//#endregion

//#region Levels
// Numeric severities so "is this enabled" is one comparison. LOG_LEVEL picks
// the floor; below-floor calls are cheap no-ops (the object is never built).
const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 } as const
type Level = keyof typeof LEVELS

function configuredFloor(): number {
  const raw = (process.env.LOG_LEVEL ?? "info").toLowerCase()
  return LEVELS[raw as Level] ?? LEVELS.info
}
//#endregion

//#region Logger
type Fields = Record<string, unknown>

// Errors don't JSON.stringify (their message/stack are non-enumerable), so any
// field holding one is expanded explicitly. Everything else passes through.
function serialize(fields: Fields): Fields {
  const out: Fields = {}
  for (const [key, value] of Object.entries(fields)) {
    out[key] =
      value instanceof Error
        ? { name: value.name, message: value.message, stack: value.stack }
        : value
  }
  return out
}

export interface Logger {
  debug(msg: string, fields?: Fields): void
  info(msg: string, fields?: Fields): void
  warn(msg: string, fields?: Fields): void
  error(msg: string, fields?: Fields): void
  /** A logger with `fields` merged into every line it emits. */
  child(fields: Fields): Logger
}

// `sink` is injectable for tests; production always writes to the real
// streams. info/debug go to stdout and warn/error to stderr — the same split
// console.log/console.error had, so `docker logs` filtering and any log
// routing that keys on the stream keep working across the migration.
type Sink = (line: string, level: Level) => void

const defaultSink: Sink = (line, level) => {
  const stream =
    LEVELS[level] >= LEVELS.warn ? process.stderr : process.stdout
  stream.write(line + "\n")
}

export function createLogger(bindings: Fields = {}, sink: Sink = defaultSink): Logger {
  const emit = (level: Level, msg: string, fields?: Fields): void => {
    // Read the floor per call, not at import: tests (and a future SIGHUP-style
    // reload) can change LOG_LEVEL without re-importing the module.
    if (LEVELS[level] < configuredFloor()) {
      return
    }
    sink(
      JSON.stringify({
        time: new Date().toISOString(),
        level,
        msg,
        ...serialize(bindings),
        ...(fields ? serialize(fields) : undefined),
      }),
      level,
    )
  }

  return {
    debug: (msg, fields) => emit("debug", msg, fields),
    info: (msg, fields) => emit("info", msg, fields),
    warn: (msg, fields) => emit("warn", msg, fields),
    error: (msg, fields) => emit("error", msg, fields),
    child: (fields) => createLogger({ ...bindings, ...fields }, sink),
  }
}

// The root logger. Modules either use this directly or derive a child with
// their own bound context (e.g. `log.child({ module: "roomManager" })`).
export const log = createLogger()
//#endregion
