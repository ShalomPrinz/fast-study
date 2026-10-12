import { Trans } from '@lingui/react/macro'
import type { ServiceFailure } from '@/shared/i18n/serviceErrors'
import ServiceError from '@/shared/components/ServiceError'
import '@/styles/button.css'
import './CourseCheckFailure.css'

interface Props {
  failure: ServiceFailure
  onSaveAnyway: () => void
  onEdit: () => void
}

// Why a pasted course URL was refused, under its input, with the way past it: save it unchecked, or edit it.
export default function CourseCheckFailure({ failure, onSaveAnyway, onEdit }: Props) {
  return (
    <div className="course-check-failure" role="alert">
      <ServiceError failure={failure} />
      <div className="course-check-failure-actions">
        <button className="btn btn--ghost course-check-save-anyway" onClick={onSaveAnyway}>
          <Trans>Save anyway</Trans>
        </button>
        <button className="btn btn--ghost course-check-edit" onClick={onEdit}>
          <Trans>Edit</Trans>
        </button>
      </div>
    </div>
  )
}
