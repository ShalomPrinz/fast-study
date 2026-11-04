// @vitest-environment jsdom
import { createElement } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render } from '@testing-library/react'
import { i18n } from '@lingui/core'
import { I18nProvider } from '@lingui/react'
import BrowserSwitch from './BrowserSwitch'
import { BROWSER_KEY, readBrowser, saveBrowser } from './browsers'

afterEach(() => {
  cleanup()
  localStorage.clear()
})

describe('BrowserSwitch', () => {
  it('marks the chosen browser and reports a click', () => {
    const onSelect = vi.fn()
    const { container } = render(
      createElement(
        I18nProvider,
        { i18n },
        createElement(BrowserSwitch, { browser: 'chrome', onSelect }),
      ),
    )
    const btns = [...container.querySelectorAll('button')]
    expect(btns.map((b) => b.textContent)).toEqual(['Google Chrome', 'Microsoft Edge'])
    expect(btns.map((b) => b.classList.contains('active'))).toEqual([true, false])
    fireEvent.click(btns[1])
    expect(onSelect).toHaveBeenCalledWith('edge')
  })
})

describe('remembered browser', () => {
  it('defaults to chrome, round-trips edge and ignores junk', () => {
    expect(readBrowser()).toBe('chrome')
    saveBrowser('edge')
    expect(readBrowser()).toBe('edge')
    localStorage.setItem(BROWSER_KEY, 'firefox')
    expect(readBrowser()).toBe('chrome')
  })
})
