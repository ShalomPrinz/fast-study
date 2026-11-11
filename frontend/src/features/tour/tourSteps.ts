import { msg } from '@lingui/core/macro'
import type { MessageDescriptor } from '@lingui/core'

export type TourSlideId = 'downloads' | 'runner' | 'lecture'

export interface TourSlide {
  // Names the screenshot `assets/tour/{he,en}/<id>.jpg`.
  id: TourSlideId
  title: MessageDescriptor
  body: MessageDescriptor
  // What the screenshot shows, for screen readers.
  alt: MessageDescriptor
}

export const TOUR_SLIDES: TourSlide[] = [
  {
    id: 'downloads',
    title: msg`Bring in recordings`,
    body: msg`Grab videos with the Chrome extension, or let the auto-downloader fetch your course.`,
    alt: msg`The Downloads screen, with the University, Extension and Manual tabs`,
  },
  {
    id: 'runner',
    title: msg`Watch it work`,
    body: msg`Each lecture moves through audio, transcript, summary and PDF on its own.`,
    alt: msg`The Running screen, with a lecture partway through its steps`,
  },
  {
    id: 'lecture',
    title: msg`Read the summary`,
    body: msg`A finished lecture opens with its PDF summary, ready to read.`,
    alt: msg`A finished lecture, showing its PDF summary`,
  },
]
