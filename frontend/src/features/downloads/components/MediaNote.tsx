import { useLingui } from '@lingui/react/macro'
import { Link } from 'react-router-dom'
import Icon from '@/shared/components/Icon'
import { useAutoRun } from '@/shared/contexts/SettingsContext'
import { ROUTES } from '@/shared/utils/routes'
import type { Media } from '../services/autoDownloader'
import { mediaNote, noteLinksSettings } from '../utils/mediaNote'
import type { MediaNote as Note } from '../utils/mediaNote'
import './MediaNote.css'

// The hint under the media cards: what the chosen side holds and what downloading one sets off.
export default function MediaNote({ media }: { media: Media }) {
  const { t } = useLingui()
  const note = mediaNote(media, useAutoRun())
  const text: Record<Note, string> = {
    'video-full': t`Recordings. Downloading one starts its full summary right away.`,
    'video-audio': t`Recordings. Downloading one extracts its audio right away; you start the summary.`,
    'video-off': t`Recordings. Downloading one starts nothing; you run the summary yourself.`,
    material: t`PDFs you can attach to any lecture or recitation. They wait until its recording is downloaded or you run the summary.`,
    unknown: t`The site doesn't say what these files are. Only videos can be downloaded from here, known only after download.`,
  }
  return (
    <p className="media-note">
      <Icon icon="info" />
      <span>
        {text[note]}
        {noteLinksSettings(note) && (
          <>
            {' '}
            <Link to={ROUTES.settings}>{t`Change in Settings`}</Link>
          </>
        )}
      </span>
    </p>
  )
}
