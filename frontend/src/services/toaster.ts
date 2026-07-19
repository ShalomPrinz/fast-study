// The only `react-toastify` import site — everything else toasts through these helpers.
import { ToastContainer, toast } from 'react-toastify'
import 'react-toastify/dist/ReactToastify.css'
import type { RunInitResult } from '@/types'
import type { ConnectionError } from '@/services/http'

export { ToastContainer }

type ToastKind = 'info' | 'error'

function appToast(kind: ToastKind, message: string): void {
  toast[kind](message)
}
export { appToast as toast }

// toastId is keyed per service, so a downed service reuses one toast instead of stacking.
export function toastConnectionError(err: ConnectionError): void {
  toast.error(err.message, { toastId: `conn:${err.baseUrl}` })
}

// Pass-through for the toastify promise lifecycle. Returns the original promise.
export function toastPromise<T>(
  promise: Promise<T>,
  messages: { pending: string; success: string; error: string },
): Promise<T> {
  return toast.promise(promise, messages)
}

export function toastInitResult(
  result: RunInitResult,
  messages: { busy: string; error: string },
): void {
  if (result.status === 'busy') appToast('error', messages.busy)
  else if (result.status === 'error') appToast('error', result.message ?? messages.error)
  // 'started' is a no-op — completion arrives via SSE.
}
