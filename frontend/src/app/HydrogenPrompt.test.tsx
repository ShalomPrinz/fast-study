// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import type { Settings } from '@/services/settings'
import HydrogenPrompt, { offersHydrogen } from './HydrogenPrompt'

const { ctx, save, fetchOptions } = vi.hoisted(() => ({
  ctx: { settings: null as unknown, setSettings: vi.fn() },
  save: vi.fn(),
  fetchOptions: vi.fn(),
}))
vi.mock('@/shared/contexts/SettingsContext', () => ({ useSettingsContext: () => ctx }))
vi.mock('@/services/settings', () => ({ saveSettings: save, fetchConfigOptions: fetchOptions }))
vi.mock('@/shared/utils/failure', () => ({ toastFailure: vi.fn() }))

const stored = (over: Partial<Settings>) =>
  ({
    geminiModel: 'gemini-3.8-flash',
    geminiAutoFallback: null,
    geminiFallbackModels: null,
    hydrogenPrompted: false,
    ...over,
  }) as Settings

describe('offersHydrogen', () => {
  it('offers for a stored other model with no answer', () => {
    expect(offersHydrogen(stored({}))).toBe(true)
  })
  it('stays silent for an unset model, hydrogen itself, an answer given, or no settings', () => {
    expect(offersHydrogen(stored({ geminiModel: null }))).toBe(false)
    expect(offersHydrogen(stored({ geminiModel: 'gemini-4-hydrogen' }))).toBe(false)
    expect(offersHydrogen(stored({ hydrogenPrompted: true }))).toBe(false)
    expect(offersHydrogen(null)).toBe(false)
  })
})

describe('HydrogenPrompt', () => {
  beforeEach(() => {
    ctx.settings = stored({})
    ctx.setSettings.mockReset()
    fetchOptions.mockReset().mockResolvedValue({
      providers: [],
      geminiModels: [
        { id: 'gemini-4-hydrogen', name: 'H' },
        { id: 'gemini-3.8-flash', name: 'F8' },
        { id: 'gemini-3.6-flash', name: 'F6' },
      ],
    })
    save.mockReset().mockResolvedValue({ geminiModel: 'x', errorReportsRestartNeeded: false })
  })

  it('renders nothing when not offered', () => {
    ctx.settings = stored({ hydrogenPrompted: true })
    render(<HydrogenPrompt />)
    expect(screen.queryByTestId('hydrogen-prompt')).toBeNull()
  })

  it('Yes puts hydrogen on top and keeps the rest of the effective order, in one save', async () => {
    render(<HydrogenPrompt />)
    fireEvent.click(screen.getByText('Yes'))
    await waitFor(() => expect(ctx.setSettings).toHaveBeenCalled())
    // Never saved: derived from Flash 3.8 as main, so 3.6 then hydrogen; hydrogen leaves the tail.
    expect(save).toHaveBeenCalledWith({
      geminiModel: 'gemini-4-hydrogen',
      geminiFallbackModels: ['gemini-3.8-flash', 'gemini-3.6-flash'],
      hydrogenPrompted: true,
    })
    expect(screen.queryByTestId('hydrogen-prompt')).toBeNull()
  })

  it('Yes keeps a saved order, including an empty tail, minus hydrogen', async () => {
    ctx.settings = stored({ geminiFallbackModels: ['gemini-4-hydrogen'] })
    render(<HydrogenPrompt />)
    fireEvent.click(screen.getByText('Yes'))
    await waitFor(() => expect(save).toHaveBeenCalled())
    expect(save).toHaveBeenCalledWith({
      geminiModel: 'gemini-4-hydrogen',
      geminiFallbackModels: ['gemini-3.8-flash'],
      hydrogenPrompted: true,
    })
  })

  it('Yes still saves when the options fetch fails: stored list kept, else the field omitted', async () => {
    fetchOptions.mockRejectedValue(new Error('down'))
    ctx.settings = stored({ geminiFallbackModels: ['gemini-4-hydrogen', 'gemini-3.6-flash'] })
    const { unmount } = render(<HydrogenPrompt />)
    fireEvent.click(screen.getByText('Yes'))
    await waitFor(() => expect(save).toHaveBeenCalledTimes(1))
    expect(save).toHaveBeenLastCalledWith({
      geminiModel: 'gemini-4-hydrogen',
      geminiFallbackModels: ['gemini-3.8-flash', 'gemini-3.6-flash'],
      hydrogenPrompted: true,
    })
    unmount()
    ctx.settings = stored({})
    render(<HydrogenPrompt />)
    fireEvent.click(screen.getByText('Yes'))
    await waitFor(() => expect(save).toHaveBeenCalledTimes(2))
    expect(save).toHaveBeenLastCalledWith({
      geminiModel: 'gemini-4-hydrogen',
      hydrogenPrompted: true,
    })
  })

  it('No and Esc save only the flag', async () => {
    const { unmount } = render(<HydrogenPrompt />)
    fireEvent.click(screen.getByText('No'))
    expect(save).toHaveBeenLastCalledWith({ hydrogenPrompted: true })
    await waitFor(() => expect(ctx.setSettings).toHaveBeenCalledTimes(1))
    unmount()
    render(<HydrogenPrompt />)
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(save).toHaveBeenLastCalledWith({ hydrogenPrompted: true })
  })
})
