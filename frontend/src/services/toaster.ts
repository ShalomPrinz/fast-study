// The only `react-toastify` import site — everything else toasts through these helpers.
import type { ReactNode } from 'react'
import { ToastContainer, toast } from 'react-toastify'
import 'react-toastify/dist/ReactToastify.css'
import './toaster.css'
import type { RunInitResult } from '@/types'
import type { ConnectionError } from '@/services/http'

export { ToastContainer }

type ToastKind = 'info' | 'warning' | 'error'

// ReactNode, not string: a failure whose sentence carries third-party text renders it in an
// isolated block beneath the sentence (`shared/components/ServiceError`).
function appToast(kind: ToastKind, message: ReactNode): void {
  toast[kind](message)
}
export { appToast as toast }

// toastId is keyed per service, so a downed service reuses one toast instead of stacking.
export function toastConnectionError(err: ConnectionError): void {
  toast.error(err.message, { toastId: `conn:${err.baseUrl}` })
}

// A loading toast its caller settles: `succeed` turns it into a success toast, `dismiss` drops it so
// the caller can report the failure its own way. The nulls fall back to the container's defaults.
export function toastPending(message: string): {
  succeed: (message: string) => void
  dismiss: () => void
} {
  const id = toast.loading(message, { closeOnClick: true })
  return {
    succeed: (message) =>
      toast.update(id, {
        render: message,
        type: 'success',
        isLoading: false,
        autoClose: null,
        closeButton: null,
        draggable: null,
      }),
    dismiss: () => toast.dismiss(id),
  }
}

// A refused run rejects instead (the backend answers 4xx with its own prose), so `busy` — the one
// refusal that is not an error — is all this has left to say. 'started' is a no-op: SSE reports it.
export function toastInitResult(result: RunInitResult, messages: { busy: string }): void {
  if (result.status === 'busy') appToast('error', messages.busy)
}
