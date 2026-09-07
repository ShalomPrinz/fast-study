import { t } from '@lingui/core/macro'
import { toast } from '@/services/toaster'
import { isBlockedError, isUnsupportedError } from '@/features/downloads/services/autoDownloader'

// The one wording for a bot-protection challenge, shared by every surface that can hit one. It
// names the wait rather than the failure, and never the account: the challenge says nothing about
// the session, so it must not read as something reconnecting would fix.
export function blockedMessage(): string {
  return t`The university site is temporarily refusing automated requests. Wait a few minutes and try again.`
}

// Only UnsupportedError carries a display-ready message; the server's `blocked` message is an
// English log line, so it is replaced. httpError/500 messages are internal, so every other failure
// (including no error at all) gets the generic copy.
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
