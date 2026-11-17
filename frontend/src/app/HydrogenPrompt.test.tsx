// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import type { Settings } from '@/services/settings'
import HydrogenPrompt, { offersHydrogen } from './HydrogenPrompt'

const { ctx, save } = vi.hoisted(() => ({
  ctx: { settings: null as unknown, setSettings: vi.fn() },
  save: vi.fn(),
}))
vi.mock('@/shared/contexts/SettingsContext', () => ({ useSettingsContext: () => ctx }))
vi.mock('@/services/settings', () => ({ saveSettings: save }))
vi.mock('@/shared/utils/failure', () => ({ toastFailure: vi.fn() }))

const stored = (over: Partial<Settings>) =>
  ({ geminiModel: 'gemini-3.8-flash', hydrogenPrompted: false, ...over }) as Settings

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
    save.mockReset().mockResolvedValue({ geminiModel: 'x', errorReportsRestartNeeded: false })
  })

  it('renders nothing when not offered', () => {
    ctx.settings = stored({ hydrogenPrompted: true })
    render(<HydrogenPrompt />)
    expect(screen.queryByTestId('hydrogen-prompt')).toBeNull()
  })

  it('Yes saves the model and the flag in one save, then hides', async () => {
    render(<HydrogenPrompt />)
    fireEvent.click(screen.getByText('Yes'))
    expect(save).toHaveBeenCalledWith({ geminiModel: 'gemini-4-hydrogen', hydrogenPrompted: true })
    await waitFor(() => expect(ctx.setSettings).toHaveBeenCalled())
    expect(screen.queryByTestId('hydrogen-prompt')).toBeNull()
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
