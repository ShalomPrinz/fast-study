// The codes a provider's quota or rate limit produces: the lecture that hit the limit, and every lecture
// run-all then stopped at that step without calling the provider. `backend/pipeline/runner.py` spells the
// same sets, and membership — not equality with one string — is what marks the quota glyph.
const QUOTA_CODES = new Set([
  'gemini_quota_exhausted',
  'gemini_quota_blocked',
  'groq_rate_limited',
  'groq_rate_limit_blocked',
])

// The graph-cropping run is not a pipeline stage: its in-flight `step` and its error record carry this
// name, and the lecture page's warning owns the failure instead of the generic error paths.
export const FIGURES_STEP = 'figures'

export function isFiguresError(error: { step: string } | null | undefined): boolean {
  return error?.step === FIGURES_STEP
}

export function isQuotaError(code: string | null | undefined): boolean {
  return !!code && QUOTA_CODES.has(code)
}
