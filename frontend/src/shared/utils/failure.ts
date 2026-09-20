import { toast } from '@/services/toaster'
import { isConnectionError } from '@/services/http'

// A request the service refused: its own prose (`{error}`, thrown by the http client) is the whole
// message, so there is nothing to add. A ConnectionError is skipped — the client already toasted it
// on construction, and reporting it here would stack a second toast for one failure.
export function toastFailure(err: unknown): void {
  if (isConnectionError(err)) return
  toast('error', err instanceof Error ? err.message : String(err))
}
