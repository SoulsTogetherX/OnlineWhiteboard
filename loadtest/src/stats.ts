//#region Types
export type Summary = {
  count: number
  min: number
  mean: number
  p50: number
  p95: number
  p99: number
  max: number
}
//#endregion

//#region Summarize
export function summarize(values: number[]): Summary {
  if (values.length === 0) {
    return { count: 0, min: 0, mean: 0, p50: 0, p95: 0, p99: 0, max: 0 }
  }

  const sorted = [...values].sort((a, b) => a - b)
  const pick = (p: number): number =>
    sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))]
  const sum = sorted.reduce((a, b) => a + b, 0)

  return {
    count: sorted.length,
    min: sorted[0],
    mean: Math.round(sum / sorted.length),
    p50: pick(0.5),
    p95: pick(0.95),
    p99: pick(0.99),
    max: sorted[sorted.length - 1],
  }
}
//#endregion
