// The only `react-toastify` import site — everything else toasts through these helpers.
import { ToastContainer, toast } from 'react-toastify'
import 'react-toastify/dist/ReactToastify.css'
import './toaster.css'
import type { RunInitResult } from '@/types'
import type { ConnectionError } from '@/services/http'

export { ToastContainer }

type ToastKind = 'info' | 'warning' | 'error'

function appToast(kind: ToastKind, message: string): void {
  toast[kind](message)
}
export { appToast as toast }

// toastId is keyed per service, so a downed service reuses one toast instead of stacking.
export function toastConnectionError(err: ConnectionError): void {
  toast.error(err.message, { toastId: `conn:${err.baseUrl}` })
}

// Pass-through for the toastify promise lifecycle. Returns the original promise.
// closeOnClick is re-stated because the pending toast is a `loading` toast, which opts out by default.
export function toastPromise<T>(
  promise: Promise<T>,
  messages: { pending: string; success: string; error: string },
): Promise<T> {
  return toast.promise(promise, messages, { closeOnClick: true })
}

// A refused run rejects instead (the backend answers 4xx with its own prose), so `busy` — the one
// refusal that is not an error — is all this has left to say. 'started' is a no-op: SSE reports it.
export function toastInitResult(result: RunInitResult, messages: { busy: string }): void {
  if (result.status === 'busy') appToast('error', messages.busy)
}
