// @vitest-environment jsdom
import { createElement } from 'react'
import { i18n } from '@lingui/core'
import { I18nProvider } from '@lingui/react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import RunRemainingButton from '@/features/lectures/components/RunRemainingButton'

const show = (inflight: boolean) =>
  createElement(
    I18nProvider,
    { i18n },
    createElement(RunRemainingButton, { inflight, onClick: vi.fn() }),
  )

afterEach(cleanup)

describe('RunRemainingButton', () => {
  it('is disabled and shows why on hover while a run is in flight', async () => {
    render(show(true))
    const btn = screen.getByRole('button', { name: /run remaining/i })
    expect((btn as HTMLButtonElement).disabled).toBe(true)
    fireEvent.pointerEnter(btn)
    fireEvent.mouseEnter(btn)
    const tip = await screen.findByRole('tooltip', {}, { timeout: 2000 })
    expect(tip.textContent).toBe('A run is already in progress here.')
  })

  it('is enabled with no tooltip when idle', () => {
    render(show(false))
    expect(
      (screen.getByRole('button', { name: /run remaining/i }) as HTMLButtonElement).disabled,
    ).toBe(false)
    expect(screen.queryByRole('tooltip')).toBeNull()
  })
})
