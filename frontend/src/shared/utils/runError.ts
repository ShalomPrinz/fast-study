// The codes a provider's quota or rate limit produces: the lecture that hit the limit, and every lecture
// run-all then stopped at that step without calling the provider. `backend/pipeline/runner.py` spells the
// same sets, and membership — not equality with one string — is what marks the quota glyph.
const QUOTA_CODES = new Set([
  'gemini_quota_exhausted',
  'gemini_quota_blocked',
  'groq_rate_limited',
  'groq_rate_limit_blocked',
])

export function isQuotaError(code: string | null | undefined): boolean {
  return !!code && QUOTA_CODES.has(code)
}
