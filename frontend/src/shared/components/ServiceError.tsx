import type { ReactNode } from 'react'
import { useLingui } from '@lingui/react'
import { resolveServiceError, type ServiceFailure } from '@/shared/i18n/serviceErrors'
import './ServiceError.css'

// A service failure in the user's language: the translated sentence, and any third-party text
// (ffmpeg, Gemini, the OS, TeX) verbatim beneath it — never the raw text on its own. `lead` names
// what the failure is about (a recording, an overview branch, a lecture) when one sentence covers several.
// `useLingui` rather than the bare catalog so a locale switch re-renders it. `headline` replaces the
// catalog sentence where the context makes it wrong, keeping the detail.
export default function ServiceError({
  failure,
  lead,
  headline: override,
}: {
  failure: ServiceFailure
  lead?: ReactNode
  headline?: string
}) {
  useLingui()
  const resolved = resolveServiceError(failure)
  const headline = override ?? resolved.headline
  const { detail } = resolved
  // One span, not a fragment: a toast (or `.settings-status`) is a flex row that would split the parts into columns.
  return (
    <span>
      {lead && (
        <strong className="service-error-lead" dir="auto">
          {lead}
        </strong>
      )}
      <span className="service-error-headline">{headline}</span>
      {detail && <span className="service-error-detail">{detail}</span>}
    </span>
  )
}

// The node form, for the call sites that hand a toast its content instead of rendering it.
export function serviceErrorNode(failure: ServiceFailure, lead?: ReactNode, headline?: string) {
  return <ServiceError failure={failure} lead={lead} headline={headline} />
}
