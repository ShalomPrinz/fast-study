import { t } from '@lingui/core/macro'
import { toast } from '@/services/toaster'
import { isConnectionError, isMoodleBusyError } from '@/services/http'
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

// Why a Moodle button is disabled: another request holds the lock, which frees by itself.
export function moodleBusyMessage(): string {
  return t`The university site is busy with another request. Try again in a moment.`
}

// A download refused before it starts: the pipeline is running or queued on the lecture it would replace.
export function toastLectureBusy(name: string): void {
  toast('error', t`Can't download ${name} while it's being processed or waiting in line`)
}

// A coded failure says why in the service's words; `blocked` gets its own copy and a codeless
// failure the generic one. A ConnectionError was already toasted by the client, and a busy lock only
// raced the push that disables the button, so neither toasts.
export function toastDownloadError(name: string, err?: unknown): void {
  if (isConnectionError(err) || isMoodleBusyError(err)) return
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
// reports instead, and for a busy lock, which is no failure. Unsupported and coded failures read in the
// service's words.
export function expandErrorText(err: unknown): string | null {
  if (isReconnectError(err) || isMoodleBusyError(err)) return null
  if (isUnsupportedError(err)) return serviceErrorText(err)
  const failure = failureOf(err)
  return failure.code ? serviceErrorText(failure) : t`Couldn't load entries. Try again.`
}

// A background job's failure — invisible without this, since the POST already returned 200. A job
// with no code falls back to the tool's own English, which is the only thing identifying it.
// `manual` marks a job the manual form started, whose refusals read differently.
export function toastJobError(name: string, failure: ServiceFailure | null, manual = false): void {
  if (!failure) {
    toast('error', t`Couldn't download "${name}". Try again.`)
    return
  }
  toast(
    'error',
    serviceErrorNode(failure, name, manual ? manualFailureHeadline(failure) : undefined),
  )
}

// A manual job's headline where the shared sentence would mislead, else undefined: a link answering
// 401/403 needs a login the form never sends — no account to reconnect.
export function manualFailureHeadline(failure: ServiceFailure): string | undefined {
  return failure.code === 'download_auth_failed'
    ? t`The site refused the download. This link needs a login, so it can't be downloaded here.`
    : undefined
}

// A failed login's failure in the words the user reads: a refused site (`moodle_site_unsupported`)
// in the service's reason, a bot challenge as the wait; null leaves it to the generic funnel.
export function loginFailure(err: unknown): ServiceFailure | string | null {
  if (isUnsupportedError(err)) return err
  if (isBlockedError(err)) return blockedMessage()
  return null
}
