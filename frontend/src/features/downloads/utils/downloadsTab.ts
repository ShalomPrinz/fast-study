// The Downloads page's tabs, in display order.
export const DOWNLOADS_TABS = ['university', 'extension', 'manual'] as const
export type DownloadsTab = (typeof DOWNLOADS_TABS)[number]

export const TAB_STORAGE_KEY = 'fastStudyDownloadsTab'

// The stored choice, else University when signed in and Extension when not or the read failed; null
// while nothing valid is stored and `connected` is still null (the first account answer is pending).
export function defaultTab(stored: string | null, connected: boolean | null): DownloadsTab | null {
  if ((DOWNLOADS_TABS as readonly string[]).includes(stored ?? '')) return stored as DownloadsTab
  if (connected === null) return null
  return connected ? 'university' : 'extension'
}
