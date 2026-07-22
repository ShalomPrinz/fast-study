import { toast } from '@/services/toaster'
import { isUnsupportedError } from '@/features/downloads/services/autoDownloader'

// Only UnsupportedError carries a display-ready message; httpError/500 messages are internal,
// so every other failure (including no error at all) gets the generic copy.
export function toastDownloadError(name: string, err?: unknown): void {
  const message = isUnsupportedError(err) ? err.message : `Couldn't download "${name}". Try again.`
  toast('error', message)
}

// A background job's failure — invisible without this, since the POST already returned 200.
// The job's `message` is the tool's own detail, so it's appended rather than swallowed.
export function toastJobError(name: string, detail: string | null): void {
  const suffix = detail ? `: ${detail}` : '. Try again.'
  toast('error', `Couldn't download "${name}"${suffix}`)
}
