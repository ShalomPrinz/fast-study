import { useLingui } from '@lingui/react/macro'
import type { RunError } from '@/types'
import Tooltip from '@/shared/components/Tooltip'
import RetryLine from '@/shared/components/RetryLine'
import Icon from '@/shared/components/Icon'
import { serviceErrorText } from '@/shared/i18n/serviceErrors'
import type { FiguresWarningView } from '@/features/lectures/utils/figuresWarning'
import { FIGURES_RUNNING_LABEL } from '@/features/lectures/constants/pipeline'
import '@/styles/button.css'
import '@/styles/spinner.css'
import './FiguresWarning.css'

interface Props {
  view: FiguresWarningView
  // The failure's record: its reason is the tooltip, its `retry` the waiting countdown.
  error: RunError | null
  onRetry: () => void
  onCancelRetry: () => Promise<unknown>
}

// One line for graphs waiting to be cropped, in both placements: the warning with Retry, or, while the
// cropping runs, plain progress.
export default function FiguresWarning({ view, error, onRetry, onCancelRetry }: Props) {
  const { t } = useLingui()
  const { placement, cropping, retryDisabled } = view

  return (
    <div
      className={`figures-warning figures-warning--${placement}${cropping ? ' figures-warning--cropping' : ''}`}
      data-figures-state={cropping ? 'cropping' : 'waiting'}
    >
      {cropping ? (
        <span className="figures-warning-text">
          <span className="spinner spinner--sm" />
          {t(FIGURES_RUNNING_LABEL)}
        </span>
      ) : (
        <>
          <div className="figures-warning-main">
            <Tooltip content={error ? serviceErrorText(error) : undefined}>
              <span className="figures-warning-text">
                <Icon icon="warning" />
                {t`Gemini didn't answer how to crop the images.`}
              </span>
            </Tooltip>
            <button
              type="button"
              className="btn btn--ghost figures-warning-retry"
              onClick={onRetry}
              disabled={retryDisabled}
            >
              {t`Retry`}
            </button>
          </div>
          {error?.retry && <RetryLine retry={error.retry} onCancel={onCancelRetry} />}
        </>
      )}
    </div>
  )
}
