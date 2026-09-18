import { t } from '@lingui/core/macro'
import { toast } from '@/services/toaster'
import { isBlockedError, isUnsupportedError } from '@/features/downloads/services/autoDownloader'

// The one wording for a bot-protection challenge: it names the wait, never the account, so it does
// not read as something reconnecting would fix.
export function blockedMessage(): string {
  return t`The university site is temporarily refusing automated requests. Wait a few minutes and try again.`
}

// Only UnsupportedError's message is display-ready; `blocked` gets its own copy and everything
// else the generic one.
export function toastDownloadError(name: string, err?: unknown): void {
  const message = isBlockedError(err)
    ? blockedMessage()
    : isUnsupportedError(err)
      ? err.message
      : t`Couldn't download "${name}". Try again.`
  toast('error', message)
}

// A background job's failure — invisible without this, since the POST already returned 200.
// The job's `message` is the tool's own detail, so it's appended rather than swallowed.
export function toastJobError(name: string, detail: string | null): void {
  // Two whole sentences rather than a spliced suffix: the detail clause is part of the copy.
  toast(
    'error',
    detail ? t`Couldn't download "${name}": ${detail}` : t`Couldn't download "${name}". Try again.`,
  )
}
