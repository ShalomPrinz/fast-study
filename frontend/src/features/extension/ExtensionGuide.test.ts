// @vitest-environment jsdom
import { createElement } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render } from '@testing-library/react'
import { i18n } from '@lingui/core'
import { I18nProvider } from '@lingui/react'
import ExtensionGuide, { EXTENSIONS_URL } from './ExtensionGuide'

function mount() {
  return render(createElement(I18nProvider, { i18n }, createElement(ExtensionGuide)))
}

function stubClipboard() {
  const writeText = vi.fn().mockResolvedValue(undefined)
  Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
  return writeText
}

afterEach(() => {
  cleanup()
  delete window.faststudy
})

describe('ExtensionGuide', () => {
  it('shows the folder path with Copy and Open folder when the bridge has the extension', () => {
    const reveal = vi.fn().mockResolvedValue(undefined)
    window.faststudy = {
      open: { file: vi.fn(), external: vi.fn() },
      extension: { path: 'C:\\FastStudy\\extension', reveal },
    }
    const { container } = mount()
    const paths = [...container.querySelectorAll('.extension-path')].map((e) => e.textContent)
    expect(paths).toEqual([EXTENSIONS_URL, 'C:\\FastStudy\\extension'])
    expect(container.querySelector('.extension-note--no-bridge')).toBeNull()
    fireEvent.click(container.querySelector('.extension-reveal')!)
    expect(reveal).toHaveBeenCalledOnce()
  })

  it('hides the folder and its buttons, still rendering every step, without the bridge', () => {
    const { container } = mount()
    expect(container.querySelector('.extension-reveal')).toBeNull()
    expect(container.querySelectorAll('.extension-path')).toHaveLength(1)
    expect(container.querySelector('.extension-note--no-bridge')).not.toBeNull()
    expect(container.querySelectorAll('.extension-step')).toHaveLength(5)
  })

  it('enlarges a screenshot on click, closes on any click, the × or Esc, and refocuses it', () => {
    const { container } = mount()
    const shots = container.querySelectorAll('.extension-shot-button')
    expect(shots.length).toBeGreaterThan(1)
    const zoom = () => document.querySelector('.extension-zoom')

    fireEvent.click(shots[0])
    expect(zoom()).not.toBeNull()
    expect(document.activeElement).toBe(document.querySelector('.extension-zoom-close'))
    fireEvent.click(document.querySelector('.extension-zoom-img')!)
    expect(zoom()).toBeNull()
    expect(document.activeElement).toBe(shots[0])

    fireEvent.click(shots[1])
    fireEvent.click(document.querySelector('.extension-zoom-close')!)
    expect(zoom()).toBeNull()
    expect(document.activeElement).toBe(shots[1])

    fireEvent.click(shots[0])
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(zoom()).toBeNull()
    expect(document.activeElement).toBe(shots[0])
  })

  it('copies the extensions address and the folder path', async () => {
    const writeText = stubClipboard()
    window.faststudy = {
      open: { file: vi.fn(), external: vi.fn() },
      extension: { path: '/state/extension', reveal: vi.fn() },
    }
    const { container } = mount()
    const [address, folder] = container.querySelectorAll('.extension-copy')
    await act(async () => fireEvent.click(address))
    await act(async () => fireEvent.click(folder))
    expect(writeText.mock.calls).toEqual([[EXTENSIONS_URL], ['/state/extension']])
  })
})
