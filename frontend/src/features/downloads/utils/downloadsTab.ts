// The Downloads page's tabs, in display order.
export const DOWNLOADS_TABS = ['university', 'extension', 'manual'] as const
export type DownloadsTab = (typeof DOWNLOADS_TABS)[number]

export const TAB_STORAGE_KEY = 'fastStudyDownloadsTab'

// The tab to open on: the user's stored choice, else University when the account is signed in and
// Extension when it is not. `null` while the account is unknown and nothing valid is stored.
export function defaultTab(
  stored: string | null,
  connected: boolean | undefined,
): DownloadsTab | null {
  if ((DOWNLOADS_TABS as readonly string[]).includes(stored ?? '')) return stored as DownloadsTab
  if (connected === undefined) return null
  return connected ? 'university' : 'extension'
}
