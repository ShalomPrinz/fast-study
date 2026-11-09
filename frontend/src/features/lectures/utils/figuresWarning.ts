import { FIGURES_STEP } from '@/shared/utils/runError'

export type FiguresPlacement = 'banner' | 'row'

export interface FiguresWarningView {
  // Above the pipeline card while it is collapsed, else under the Summary row's file name.
  placement: FiguresPlacement
  // Under the Summary row's file name: whenever the rows are shown, the steps modal's included.
  inRow: boolean
  // The cropping run is on: the line reads as progress, with no Retry to press.
  cropping: boolean
  // Any run on the lecture, the graph run included, would only answer `busy`.
  retryDisabled: boolean
}

/** What the lecture page shows for graphs waiting to be cropped; null when none wait. */
export function figuresWarning(s: {
  pending: boolean
  complete: boolean
  // The steps modal is open over a collapsed pipeline.
  stepsOpen: boolean
  // The lecture's in-flight step, whatever it is; null when idle.
  inflightStep: string | null
}): FiguresWarningView | null {
  if (!s.pending) return null
  return {
    placement: s.complete ? 'banner' : 'row',
    inRow: !s.complete || s.stepsOpen,
    cropping: s.inflightStep === FIGURES_STEP,
    retryDisabled: s.inflightStep !== null,
  }
}
