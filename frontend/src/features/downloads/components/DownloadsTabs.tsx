import { useLingui } from '@lingui/react/macro'
import { DOWNLOADS_TABS } from '@/features/downloads/utils/downloadsTab'
import type { DownloadsTab } from '@/features/downloads/utils/downloadsTab'
import '@/styles/segmented.css'

interface Props {
  // Null while the default is still settling: no segment is selected.
  tab: DownloadsTab | null
  onSelect: (tab: DownloadsTab) => void
}

// The page's tab row, worn as the light segmented switch; it sits in the header, its body below.
export default function DownloadsTabs({ tab, onSelect }: Props) {
  const { t } = useLingui()
  const labels: Record<DownloadsTab, string> = {
    university: t`University`,
    extension: t`Extension`,
    manual: t`Manual`,
  }
  return (
    <div
      className="mode-toggle mode-toggle--light downloads-tabs"
      role="tablist"
      data-tour="downloads-tabs"
    >
      {DOWNLOADS_TABS.map((id) => (
        <button
          key={id}
          role="tab"
          aria-selected={tab === id}
          className={`mode-toggle-btn${tab === id ? ' active' : ''}`}
          onClick={() => onSelect(id)}
        >
          {labels[id]}
        </button>
      ))}
    </div>
  )
}
