import { t } from '@lingui/core/macro'
import { toast } from '@/services/toaster'
import { isBlockedError, isUnsupportedError } from '@/features/downloads/services/autoDownloader'
import { serviceErrorNode } from '@/shared/components/ServiceError'
import type { ServiceFailure } from '@/shared/i18n/serviceErrors'

// The one wording for a bot-protection challenge: it names the wait, never the account, so it does
// not read as something reconnecting would fix.
export function blockedMessage(): string {
  return t`The university site is temporarily refusing automated requests. Wait a few minutes and try again.`
}

// Only an UnsupportedError carries a code worth resolving; `blocked` gets its own copy and
// everything else the generic one.
export function toastDownloadError(name: string, err?: unknown): void {
  if (isUnsupportedError(err)) {
    toast('error', serviceErrorNode(err))
    return
  }
  toast(
    'error',
    isBlockedError(err) ? blockedMessage() : t`Couldn't download "${name}". Try again.`,
  )
}

// A background job's failure — invisible without this, since the POST already returned 200. A job
// with no code falls back to the tool's own English, which is the only thing identifying it.
export function toastJobError(name: string, failure: ServiceFailure | null): void {
  if (!failure) {
    toast('error', t`Couldn't download "${name}". Try again.`)
    return
  }
  toast('error', serviceErrorNode(failure, name))
}
