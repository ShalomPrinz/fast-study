import { useLingui } from '@lingui/react/macro'
import { reopenPasscode, usePausedRuns } from '@/features/downloads/contexts/SectionRunsContext'
import { expandSection } from '@/features/downloads/contexts/SectionCollapseContext'
import { parseSectionId, sectionTitle } from '@/features/downloads/utils/sections'
import type { Media } from '@/features/downloads/services/autoDownloader'
import './PausedRunsBanner.css'

interface Props {
  course: string
  media: Media | null
  onSelectMedia: (media: Media) => void
  // Switches to the New view, where a course run's prompt renders.
  onShowNew?: () => void
}

// Every run parked at a passcode gate, since the prompt renders only in its own `SectionGroup` (All) or
// the New view (course run). A run in the open course is a button: it reopens a closed prompt, jumping
// segments or scope first — see docs/BULK.md.
export default function PausedRunsBanner({ course, media, onSelectMedia, onShowNew }: Props) {
  const { t } = useLingui()
  const paused = usePausedRuns()
  if (!paused.length) return null

  return (
    <div className="recordings-paused-banner">
      {paused.map((run) => {
        // The New view's course run: its prompt sits in the view, one click from a closed state.
        if (run.scope === 'course') {
          const label = t`The course download is waiting for a passcode`
          if (run.course !== course)
            return (
              <div key={run.id} className="recordings-paused-entry" dir="auto">
                {run.course} · {label}
              </div>
            )
          return (
            <button
              key={run.id}
              className="recordings-paused-entry recordings-paused-entry--link"
              dir="auto"
              onClick={() => {
                reopenPasscode(run.id)
                if (media !== null) onShowNew?.()
              }}
            >
              {label}
            </button>
          )
        }
        const parsed = parseSectionId(run.sectionId)
        const label = parsed
          ? t`Section ${sectionTitle(parsed.title)} is waiting for a passcode`
          : t`A section is waiting for a passcode`
        // Nothing to open: another course, or an id this page can't read.
        if (!parsed || parsed.course !== course)
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
            onClick={() => {
              reopenPasscode(run.id)
              expandSection(run.sectionId)
              if (parsed.media !== media) onSelectMedia(parsed.media)
            }}
          >
            {label}
          </button>
        )
      })}
    </div>
  )
}
