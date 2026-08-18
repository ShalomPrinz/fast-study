import { useLingui } from '@lingui/react'
import { isRtl } from '@/services/i18n'

// A disclosure triangle. Collapsed, it points along the reading direction — into the text it would
// reveal — so it has to flip in Hebrew; open, it points down in both directions.
// `useLingui` rather than `document.dir` so a locale switch re-renders the glyph.
export default function Chevron({ open }: { open: boolean }) {
  const { i18n } = useLingui()
  if (open) return <>▾</>
  return <>{isRtl(i18n.locale) ? '◂' : '▸'}</>
}
