// The two codes Gemini's daily quota produces: the lecture that hit the limit, and every lecture
// run-all then stopped at summarize without calling Gemini. `backend/pipeline/runner.py` spells the
// same pair, and membership — not equality with one string — is what marks the quota glyph.
const GEMINI_QUOTA_CODES = new Set(['gemini_quota_exhausted', 'gemini_quota_blocked'])

export function isGeminiQuota(code: string | null | undefined): boolean {
  return !!code && GEMINI_QUOTA_CODES.has(code)
}
