import { t } from '@lingui/core/macro'
import { runtimeBridge } from './runtime'
import type { ReportResult } from './runtime'
import { toast } from './toaster'

// The single boundary for mailing a crash report. Everything risky about it is main's — writing the
// file, composing and truncating the `mailto:` — so this hands over fields and reports the outcome.

/** Whether a report can be sent at all. Browser dev has no bridge, and so no version and no launch
 *  log: there is nothing worth mailing, which is why the button is hidden rather than disabled. */
export function canSendReport(): boolean {
  return runtimeBridge() !== undefined
}

/** Mail the error boundary's report. `path` names the file main wrote, for the user to attach; it is
 *  null when the write failed, which never stops the mail from opening. */
export async function mailErrorReport(fields: {
  details: string
  error: string
  route: string
}): Promise<ReportResult> {
  const bridge = runtimeBridge()
  // Unreachable in the UI: the button that calls this renders only when `canSendReport()`.
  if (!bridge) return { ok: false, path: null, error: 'no desktop bridge' }
  const result = await bridge.report.mail(fields)
  if (!result.ok) toast('error', t`Could not open your mail app: ${result.error ?? 'unknown error'}`)
  return result
}
