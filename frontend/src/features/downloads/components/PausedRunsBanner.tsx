import { useLingui } from '@lingui/react/macro'
import { usePausedRuns } from '@/features/downloads/contexts/SectionRunsContext'
import { parseSectionId, sectionTitle } from '@/features/downloads/utils/sections'
import type { Media } from '@/features/downloads/services/autoDownloader'
import './PausedRunsBanner.css'

interface Props {
  course: string
  media: Media
  onSelectMedia: (media: Media) => void
}

// Every run parked at a passcode gate, since the prompt renders only in its own `SectionGroup`. Only
// a run in the open course on another segment is a jump target — see docs/BULK.md.
export default function PausedRunsBanner({ course, media, onSelectMedia }: Props) {
  const { t } = useLingui()
  const paused = usePausedRuns()
  if (!paused.length) return null

  return (
    <div className="recordings-paused-banner">
      {paused.map((run) => {
        const parsed = parseSectionId(run.sectionId)
        const label = parsed
          ? t`Section ${sectionTitle(parsed.title)} is waiting for a passcode`
          : t`A section is waiting for a passcode`
        // Nothing to jump to: another course, an id this page can't read, or the open segment —
        // where the section is already on screen with its prompt, so a link would do nothing.
        if (!parsed || parsed.course !== course || parsed.media === media)
          return (
            <div key={run.id} className="recordings-paused-entry" dir="auto">
              {run.course !== course && `${run.course} · `}
              {label}
            </div>
          )
        return (
          <button
            key={run.id}
            className="recordings-paused-entry recordings-paused-entry--link"
            dir="auto"
            onClick={() => onSelectMedia(parsed.media)}
          >
            {label}
          </button>
        )
      })}
    </div>
  )
}
