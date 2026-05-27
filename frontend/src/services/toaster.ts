// Single boundary around `react-toastify`. Components and hooks call these
// helpers — they must not import from `react-toastify` directly.
import { ToastContainer, toast } from 'react-toastify'
import 'react-toastify/dist/ReactToastify.css'
import type { RunInitResult } from '@/types'

export { ToastContainer }

type ToastKind = 'info' | 'error'

// Surface a toast of the given kind and message.
function appToast(kind: ToastKind, message: string): void {
  toast[kind](message)
}
export { appToast as toast }

// Pass-through for the toastify promise lifecycle. Returns the original promise.
export function toastPromise<T>(
  promise: Promise<T>,
  messages: { pending: string; success: string; error: string },
): Promise<T> {
  return toast.promise(promise, messages)
}

// Surface a 'busy'/'error' RunInitResult to the user as a toast.
export function toastInitResult(
  result: RunInitResult,
  messages: { busy: string; error: string },
): void {
  if (result.status === 'busy') appToast('error', messages.busy)
  else if (result.status === 'error') appToast('error', result.message ?? messages.error)
  // 'started' is a no-op — completion arrives via SSE-driven status updates.
}
