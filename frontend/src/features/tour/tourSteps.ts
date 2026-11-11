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
    title: msg`Start in Downloads`,
    body: msg`Bring recordings in from here: pick a course and download its videos.`,
  },
  {
    id: 'downloads-tabs',
    shot: 'downloads',
    title: msg`Three ways to download`,
    body: msg`Use your university account, the Chrome extension, or add a file by hand.`,
  },
  {
    id: 'downloads-scope',
    shot: 'downloads',
    title: msg`New or all`,
    body: msg`See only the recordings you have not downloaded yet, or every recording in the course.`,
  },
  {
    id: 'lectures-nav',
    shot: 'lecture',
    title: msg`Your lectures`,
    body: msg`Every downloaded recording lives under Lectures, and its summary is created on its own.`,
  },
  {
    id: 'lectures-tree',
    shot: 'lecture',
    title: msg`Courses and lectures`,
    body: msg`Each course lists its lectures and recitations. Pick one to open it.`,
  },
  {
    id: 'lecture-pdf',
    shot: 'lecture',
    title: msg`The PDF summary`,
    body: msg`A finished lecture opens with its summary, ready to read right here.`,
  },
  {
    id: 'lecture-ai',
    shot: 'lecture',
    title: msg`Study with AI`,
    body: msg`Open a chat with the lecture's content and ask questions about it.`,
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
