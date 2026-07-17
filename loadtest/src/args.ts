//#region Types
export type ParsedArgs = Record<string, string>
//#endregion

//#region Parsing
export function parseArgs(argv: string[]): ParsedArgs {
  const out: ParsedArgs = {}
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (!arg.startsWith("--")) {
      continue
    }
    const key = arg.slice(2)
    const next = argv[i + 1]
    if (next !== undefined && !next.startsWith("--")) {
      out[key] = next
      i += 1
    } else {
      out[key] = "true"
    }
  }
  return out
}

export function num(args: ParsedArgs, key: string, fallback: number): number {
  const raw = args[key]
  if (raw === undefined) {
    return fallback
  }
  const parsed = Number(raw)
  return Number.isFinite(parsed) ? parsed : fallback
}

export function str(args: ParsedArgs, key: string, fallback: string): string {
  return args[key] ?? fallback
}
//#endregion
