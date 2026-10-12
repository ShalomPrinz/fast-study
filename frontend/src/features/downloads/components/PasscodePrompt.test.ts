// @vitest-environment jsdom
import { createElement } from 'react'
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, fireEvent, cleanup } from '@testing-library/react'
import { i18n } from '@lingui/core'
import { I18nProvider } from '@lingui/react'
import PasscodePrompt from './PasscodePrompt'

i18n.activate('en')

function open(onDismiss?: () => void) {
  const onCancel = vi.fn()
  render(
    createElement(I18nProvider, {
      i18n,
      children: createElement(PasscodePrompt, {
        reason: 'missing',
        busy: false,
        onSubmit: vi.fn(),
        onCancel,
        onDismiss,
      }),
    }),
  )
  return onCancel
}

afterEach(cleanup)

describe('PasscodePrompt', () => {
  it('only closes on Escape or an overlay click when given onDismiss', () => {
    const onDismiss = vi.fn()
    const onCancel = open(onDismiss)
    fireEvent.keyDown(document, { key: 'Escape' })
    fireEvent.click(document.querySelector('.modal-overlay')!)
    expect(onDismiss).toHaveBeenCalledTimes(2)
    expect(onCancel).not.toHaveBeenCalled()
    fireEvent.click(document.querySelector('.btn--ghost')!)
    expect(onCancel).toHaveBeenCalledTimes(1)
  })

  it('cancels on Escape and an overlay click without onDismiss', () => {
    const onCancel = open()
    fireEvent.keyDown(document, { key: 'Escape' })
    fireEvent.click(document.querySelector('.modal-overlay')!)
    expect(onCancel).toHaveBeenCalledTimes(2)
  })
})
