import { toast } from '@/services/toaster'
import { resolveServiceError } from '@/shared/i18n/serviceErrors'
import type { Notice } from '@/types'

// Ids are unique across both status endpoints, so one set serves every source. A source's first
// load only records its notices: ones raised before the page loaded were already shown.
const seen = new Set<number>()
const primed = new Set<string>()

/** Info-toasts each notice once per id; `source` names the endpoint whose first load is silent. */
export function announceNotices(source: string, notices: Notice[]): void {
  const quiet = !primed.has(source)
  primed.add(source)
  for (const n of notices) {
    if (seen.has(n.id)) continue
    seen.add(n.id)
    if (quiet) continue
    toast('info', resolveServiceError({ message: n.code, code: n.code, params: n.params }).headline)
  }
}

/** Test-only: forgets every seen id and primed source. */
export function resetNotices(): void {
  seen.clear()
  primed.clear()
}
