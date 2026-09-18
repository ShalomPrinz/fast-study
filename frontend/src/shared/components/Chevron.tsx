import { useLingui } from '@lingui/react'
import { isRtl } from '@/services/i18n'

// A disclosure triangle: collapsed it points along the reading direction, so it flips in Hebrew.
// `useLingui` rather than `document.dir` so a locale switch re-renders it.
export default function Chevron({ open }: { open: boolean }) {
  const { i18n } = useLingui()
  if (open) return <>▾</>
  return <>{isRtl(i18n.locale) ? '◂' : '▸'}</>
}
