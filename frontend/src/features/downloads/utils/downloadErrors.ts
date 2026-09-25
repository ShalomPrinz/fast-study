import { t } from '@lingui/core/macro'
import { toast } from '@/services/toaster'
import { isConnectionError } from '@/services/http'
import {
  isBlockedError,
  isReconnectError,
  isUnsupportedError,
} from '@/features/downloads/services/autoDownloader'
import { serviceErrorNode } from '@/shared/components/ServiceError'
import { serviceErrorText, type ServiceFailure } from '@/shared/i18n/serviceErrors'
import { failureOf } from '@/shared/utils/failure'

// The one wording for a bot-protection challenge: it names the wait, never the account, so it does
// not read as something reconnecting would fix.
export function blockedMessage(): string {
  return t`The university site is temporarily refusing automated requests. Wait a few minutes and try again.`
}

// A coded failure says why in the service's words; `blocked` gets its own copy and a codeless
// failure the generic one. A ConnectionError was already toasted by the client.
export function toastDownloadError(name: string, err?: unknown): void {
  if (isConnectionError(err)) return
  if (isUnsupportedError(err)) {
    toast('error', serviceErrorNode(err))
    return
  }
  const failure = failureOf(err)
  if (failure.code) {
    toast('error', serviceErrorNode(failure, name))
    return
  }
  toast(
    'error',
    isBlockedError(err) ? blockedMessage() : t`Couldn't download "${name}". Try again.`,
  )
}

// A playlist row's failure to expand, shown in the row; null for a reconnect, which the account chip
// reports instead. Unsupported and coded failures read in the service's words.
export function expandErrorText(err: unknown): string | null {
  if (isReconnectError(err)) return null
  if (isUnsupportedError(err)) return serviceErrorText(err)
  const failure = failureOf(err)
  return failure.code ? serviceErrorText(failure) : t`Couldn't load entries. Try again.`
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
