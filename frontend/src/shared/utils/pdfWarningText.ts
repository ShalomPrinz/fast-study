import { t } from '@lingui/core/macro'

// Mirrors backend `MISSING_CHARS_WARNING`; pdfWarningDrift.test.ts fails when the two diverge.
export const MISSING_CHARS_WARNING = 'summary contains characters the font lacks'

// A PDF render warning is code-less English prose, `; `-joined when several. The one marker with a
// translation is swapped by exact match; any other text stays verbatim.
export function pdfWarningText(warning: string): string {
  return warning
    .split('; ')
    .map((part) =>
      part === MISSING_CHARS_WARNING
        ? t`The summary contains invalid characters Gemini wrote`
        : part,
    )
    .join('; ')
}
