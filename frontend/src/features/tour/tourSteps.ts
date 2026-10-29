import { msg } from '@lingui/core/macro'
import type { MessageDescriptor } from '@lingui/core'
import type { Course, Kind } from '@/types'
import { path, kindQuery } from '@/shared/utils/url'
import { ROUTES } from '@/shared/utils/routes'
import { showsPdfHero } from '@/features/lectures/utils/lectureProgress'

export type TourStepId =
  'sidebar' | 'downloads' | 'runner' | 'lecture' | 'editor' | 'search' | 'drive'

// How a step finds its screen: a fixed route, the first lecture that shows its PDF preview or has a summary, or the current screen.
export type TourRoute = string | 'lecture-pdf' | 'lecture-editor' | null

export interface TourStep {
  id: TourStepId
  // The `data-tour` value of the element to spotlight; absent from the page means the screenshot card.
  anchor: string
  route: TourRoute
  placement: 'inline-start' | 'inline-end' | 'bottom'
  title: MessageDescriptor
  body: MessageDescriptor
}

export const TOUR_STEPS: TourStep[] = [
  {
    id: 'sidebar',
    anchor: 'sidebar',
    route: null,
    placement: 'inline-end',
    title: msg`Find your way around`,
    body: msg`The sidebar takes you between your lectures, the running pipelines, Downloads, Search and Settings.`,
  },
  {
    id: 'downloads',
    anchor: 'downloads-tabs',
    route: ROUTES.downloads,
    placement: 'bottom',
    title: msg`Bring in recordings`,
    body: msg`Capture a lecture video from your browser with the Chrome extension, or let the auto-downloader fetch the recordings of your university course for you.`,
  },
  {
    id: 'runner',
    anchor: 'runner-run',
    route: ROUTES.running,
    placement: 'bottom',
    title: msg`Watch a lecture being processed`,
    body: msg`Each lecture runs through its steps: audio, transcript, summary, PDF and Drive. Here you see the current step, its progress and the time left.`,
  },
  {
    id: 'lecture',
    anchor: 'lecture-pdf',
    route: 'lecture-pdf',
    placement: 'bottom',
    title: msg`Read the finished lecture`,
    body: msg`A finished lecture opens with its PDF summary. Open it in full screen, or send it to Google Drive.`,
  },
  {
    id: 'editor',
    anchor: 'summary-editor',
    route: 'lecture-editor',
    placement: 'inline-start',
    title: msg`Fix the summary`,
    body: msg`Edit the summary text next to the PDF, then update the PDF to see your changes.`,
  },
  {
    id: 'search',
    anchor: 'search-field',
    route: ROUTES.search,
    placement: 'bottom',
    title: msg`Search your summaries`,
    body: msg`Type a phrase to find it across the summaries of a course, with the lecture it came from.`,
  },
  {
    id: 'drive',
    anchor: 'settings-drive',
    route: ROUTES.settings,
    placement: 'bottom',
    title: msg`Keep a copy in Google Drive`,
    body: msg`Turn on Google Drive in Settings and every finished PDF is uploaded to the folder you choose.`,
  },
]

function firstLecture(
  courses: Course[],
  has: (l: Course['lectures'][number]) => boolean,
): { course: string; lecture: string; kind: Kind } | null {
  for (const c of courses) {
    for (const [kind, list] of [
      ['lecture', c.lectures],
      ['recitation', c.recitations],
    ] as const) {
      const hit = list.find(has)
      if (hit) return { course: c.name, lecture: hit.name, kind }
    }
  }
  return null
}

// The path to open for a step, or null to stay on the current screen (no such lecture: the card shows).
export function tourRoutePath(
  route: TourRoute,
  courses: Course[],
  driveEnabled: boolean,
): string | null {
  if (route === 'lecture-pdf') {
    const hit = firstLecture(courses, (l) => showsPdfHero(l.files, driveEnabled))
    return hit && path`/${hit.course}/${hit.lecture}` + kindQuery(hit.kind)
  }
  if (route === 'lecture-editor') {
    const hit = firstLecture(courses, (l) => l.files['summary.md'].exists)
    return hit && path`/${hit.course}/${hit.lecture}/edit` + kindQuery(hit.kind)
  }
  return route
}
