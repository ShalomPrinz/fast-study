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
