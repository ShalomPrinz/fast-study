import { Trans, useLingui } from '@lingui/react/macro'

// Names a lecture inside translated copy. Each name sits in a <bdi>, which a `dir="auto"` ancestor
// skips, so the line takes its direction from the translated words rather than a Hebrew name.
export default function LectureLead({ course, lecture }: { course: string; lecture: string }) {
  return (
    <Trans>
      "<bdi>{lecture}</bdi>" in "<bdi>{course}</bdi>"
    </Trans>
  )
}

// The assignment counterpart; `ServiceError` already isolates the whole lead in a <bdi>.
export function AssignmentLead({ course, assignment }: { course: string; assignment: string }) {
  const { t } = useLingui()
  return <>{t`${course} · assignment ${assignment}`}</>
}
