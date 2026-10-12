import type { ReactNode } from 'react'
import { toast } from '@/services/toaster'
import { isConnectionError, RequestError } from '@/services/http'
import { serviceErrorNode } from '@/shared/components/ServiceError'
import type { ServiceFailure } from '@/shared/i18n/serviceErrors'

// Any thrown value in the protocol's failure shape: a refused request, or any error carrying a string
// `code` (a feature's typed refusal), keeps its code and params; anything else resolves through the fallback.
export function failureOf(err: unknown): ServiceFailure {
  if (err instanceof RequestError) {
    return { message: err.message, code: err.code, params: err.params }
  }
  if (carriesCode(err)) return { message: err.message, code: err.code, params: err.params ?? null }
  return { message: err instanceof Error ? err.message : String(err) }
}

// Duck-typed so `shared/` needs no import from a feature's error classes.
function carriesCode(err: unknown): err is Error & ServiceFailure & { code: string } {
  return err instanceof Error && typeof (err as { code?: unknown }).code === 'string'
}

// The one funnel for a refused request's wording. A ConnectionError is skipped — the client already
// toasted it on construction, and reporting it here would stack a second toast for one failure.
export function toastFailure(err: unknown): void {
  if (isConnectionError(err)) return
  toast('error', failureNode(err))
}

// The same failure as a node, for the call sites that show it in place instead of toasting.
export function failureNode(err: unknown): ReactNode {
  return serviceErrorNode(failureOf(err))
}
