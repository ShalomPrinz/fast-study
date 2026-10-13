// The Downloads page's tabs, in display order.
export const DOWNLOADS_TABS = ['university', 'extension', 'manual'] as const
export type DownloadsTab = (typeof DOWNLOADS_TABS)[number]

export const TAB_STORAGE_KEY = 'fastStudyDownloadsTab'

// The tab to open on: the user's stored choice, else University when the account is signed in and
// Extension when it is not or its read failed. `connected` is null until the first account answer
// settles, and so is the result when nothing valid is stored — the page shows a spinner meanwhile.
export function defaultTab(stored: string | null, connected: boolean | null): DownloadsTab | null {
  if ((DOWNLOADS_TABS as readonly string[]).includes(stored ?? '')) return stored as DownloadsTab
  if (connected === null) return null
  return connected ? 'university' : 'extension'
}
