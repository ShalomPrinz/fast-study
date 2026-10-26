import type { AutoRun } from '@/services/settings'
import type { Media } from '../services/autoDownloader'

// Which hint sits under the media cards: only the video side depends on AUTO_RUN, since only a
// video download starts a pipeline step — so only its hints point at Settings.
export type MediaNote = `video-${AutoRun}` | 'material' | 'assignment' | 'unknown'

export function mediaNote(media: Media, autoRun: AutoRun): MediaNote {
  return media === 'video' ? `video-${autoRun}` : media
}

export function noteLinksSettings(note: MediaNote): boolean {
  return note.startsWith('video-')
}
