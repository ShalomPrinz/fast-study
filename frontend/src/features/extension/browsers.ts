export type Browser = 'chrome' | 'edge'

// The browser's own extensions page; the bridge's `open.external` refuses it, so the user pastes it.
export function extensionsUrl(browser: Browser): string {
  return browser === 'edge' ? 'edge://extensions' : 'chrome://extensions'
}

// Where a step's screenshot lives under `assets/extension-guide/`, relative to the glob's base.
export function shotKey(browser: Browser, step: string): string {
  return `${browser}/${step}.png`
}

export const BROWSER_KEY = 'fastStudyExtensionBrowser'

export const BROWSERS: readonly Browser[] = ['chrome', 'edge']

// The remembered choice; anything unknown (or no storage) is Chrome.
export function readBrowser(): Browser {
  try {
    const stored = localStorage.getItem(BROWSER_KEY)
    return BROWSERS.find((b) => b === stored) ?? 'chrome'
  } catch {
    return 'chrome'
  }
}

export function saveBrowser(browser: Browser): void {
  try {
    localStorage.setItem(BROWSER_KEY, browser)
  } catch {
    // Storage blocked: the choice just isn't remembered.
  }
}
