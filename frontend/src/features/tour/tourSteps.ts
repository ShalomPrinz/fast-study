import { msg } from '@lingui/core/macro'
import type { MessageDescriptor } from '@lingui/core'

export type TourShotId = 'downloads' | 'lecture'

export interface TourShot {
  // Names the screenshot `assets/tour/{he,en}/<id>.jpg`.
  id: TourShotId
  // What the screenshot shows, for screen readers.
  alt: MessageDescriptor
}

export interface TourStep {
  // Keys the step's element rect in `assets/tour/rects.json` (written by scripts/capture-tour.mjs).
  id: string
  shot: TourShotId
  title: MessageDescriptor
  body: MessageDescriptor
  // The box sits level with the element's top rather than its middle (see placeCallout).
  alignTop?: boolean
}

export const TOUR_SHOTS: TourShot[] = [
  {
    id: 'downloads',
    alt: msg`The Downloads screen, with the University, Extension and Manual tabs`,
  },
  { id: 'lecture', alt: msg`A finished lecture, showing its PDF summary` },
]

export const TOUR_STEPS: TourStep[] = [
  {
    id: 'downloads-nav',
    shot: 'downloads',
    title: msg`Download recordings`,
    body: msg`Download recordings here so you can summarize them.`,
  },
  {
    id: 'downloads-tabs',
    shot: 'downloads',
    title: msg`Three ways to download`,
    body: msg`Use your university account, the browser extension, or a link.`,
  },
  {
    id: 'downloads-recording',
    shot: 'downloads',
    title: msg`Download a recording`,
    body: msg`Choose a name for the recording and download it.`,
  },
  {
    id: 'lectures-nav',
    shot: 'lecture',
    title: msg`Your lectures`,
    body: msg`Downloaded recordings appear on the Lectures page.`,
  },
  {
    id: 'lectures-tree',
    shot: 'lecture',
    title: msg`Courses and lectures`,
    body: msg`Each course shows the lectures, recitations and assignments you downloaded to it.`,
    // The tree is tall; centred, the box would cover the lecture's title beside it.
    alignTop: true,
  },
  {
    id: 'lecture-pdf',
    shot: 'lecture',
    title: msg`The recording summary`,
    body: msg`Once a lecture is processed, its summary appears on this page.`,
  },
  {
    id: 'lecture-ai',
    shot: 'lecture',
    title: msg`Study with AI`,
    body: msg`Open a chat with the lecture's content to study it with AI.`,
  },
]

// The steps shown on one screenshot, as [first, last] indexes into TOUR_STEPS.
export function shotRange(steps: TourStep[], shot: TourShotId): [number, number] {
  const first = steps.findIndex((s) => s.shot === shot)
  const last = steps.length - 1 - [...steps].reverse().findIndex((s) => s.shot === shot)
  return [first, last]
}

// The step a screenshot displays while `index` is the active one: its own step, else its nearest end, so a slide
// leaving the view keeps the highlight it had instead of jumping.
export function stepOnShot(steps: TourStep[], shot: TourShotId, index: number): number {
  const [first, last] = shotRange(steps, shot)
  return Math.min(last, Math.max(first, index))
}
