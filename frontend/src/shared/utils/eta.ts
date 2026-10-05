// An ETA bar's reading at clock `now` (ms): seconds elapsed since `startedAt` (ms), never negative,
// against `estimated` seconds of which `completedFraction` was done before the start.
export function etaProgress(
  estimated: number,
  startedAt: number,
  now: number,
  completedFraction = 0,
): { elapsed: number; fillPct: number; remaining: number; overflowing: boolean } {
  const elapsed = Math.max((now - startedAt) / 1000, 0)
  const effective = completedFraction * estimated + elapsed
  return {
    elapsed,
    fillPct: Math.min((effective / estimated) * 100, 100),
    remaining: Math.max(estimated - effective, 0),
    overflowing: effective >= estimated,
  }
}
