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

// Page-level notice for every run parked at a passcode gate: the prompt itself lives in the run's
// own `SectionGroup`, which is off-screen on the other segments and absent for any other course.
// Only a run in the open course, on a segment other than the open one, is a jump target — another
// course's rows aren't discovered yet, and a run on this segment already renders its own prompt.
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
