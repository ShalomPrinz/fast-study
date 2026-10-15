// @vitest-environment jsdom
import { createElement } from 'react'
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, fireEvent, cleanup, waitFor } from '@testing-library/react'
import { i18n } from '@lingui/core'
import { I18nProvider } from '@lingui/react'
import type { AuthStatus } from '@/features/downloads/services/autoDownloader'
import CaptchaBanner from './CaptchaBanner'

const { auth, showWindow, toastFailure } = vi.hoisted(() => ({
  auth: { status: null as AuthStatus | null },
  showWindow: vi.fn(),
  toastFailure: vi.fn(),
}))
vi.mock('@/features/downloads/contexts/AuthStatusContext', () => ({
  useAuthStatus: () => ({ status: auth.status }),
}))
vi.mock('@/features/downloads/services/autoDownloader', () => ({ showWindow }))
vi.mock('@/shared/utils/failure', () => ({ toastFailure }))

i18n.activate('en')

// jsdom has no ResizeObserver; this one reports once, on observe, as the real one does.
vi.stubGlobal(
  'ResizeObserver',
  class {
    constructor(private cb: () => void) {}
    observe() {
      this.cb()
    }
    disconnect() {}
  },
)

function mount(status: AuthStatus | null) {
  auth.status = status
  render(createElement(I18nProvider, { i18n, children: createElement(CaptchaBanner) }))
}

const button = () => document.querySelector<HTMLButtonElement>('.captcha-banner-show')

afterEach(() => {
  cleanup()
  showWindow.mockReset()
  toastFailure.mockReset()
})

describe('CaptchaBanner', () => {
  it('renders nothing while no captcha waits', () => {
    mount({ connected: true, expired: false, zoomCaptcha: false })
    expect(document.querySelector('.captcha-banner')).toBeNull()
  })

  it('names the waiting captcha in its modifier', () => {
    mount({ connected: true, expired: false, zoomCaptcha: true })
    expect(document.querySelector('.captcha-banner--zoom')).not.toBeNull()
    cleanup()
    mount({ connected: true, expired: false, challenge: { open: true, captcha: true } })
    expect(document.querySelector('.captcha-banner--site')).not.toBeNull()
  })

  it('publishes its height on :root while shown and clears it on hide', () => {
    const height = () => document.documentElement.style.getPropertyValue('--captcha-banner-h')
    mount({ connected: true, expired: false, zoomCaptcha: true })
    expect(height()).toBe('0px')
    cleanup()
    expect(height()).toBe('')
  })

  it('raises the window once, disabling the button while the call is in flight', async () => {
    let settle!: () => void
    showWindow.mockReturnValue(new Promise<void>((r) => (settle = r)))
    mount({ connected: true, expired: false, zoomCaptcha: true })

    fireEvent.click(button()!)
    expect(showWindow).toHaveBeenCalledOnce()
    expect(button()!.disabled).toBe(true)

    settle()
    await waitFor(() => expect(button()!.disabled).toBe(false))
  })

  it('toasts a refusal through the shared failure path', async () => {
    const err = new Error('no window is waiting on a captcha')
    showWindow.mockRejectedValue(err)
    mount({ connected: true, expired: false, zoomCaptcha: true })

    fireEvent.click(button()!)
    await waitFor(() => expect(toastFailure).toHaveBeenCalledWith(err))
  })
})
