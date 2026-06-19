export type IconName = 'external-link' | 'edit' | 'refresh' | 'archive' | 'unarchive' | 'archive-box'

const ExternalLinkIcon = () => (
  <svg width="13" height="13" viewBox="0 0 13 13" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path d="M5 2H2a1 1 0 0 0-1 1v8a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1V8" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
    <path d="M8 1h4v4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/>
    <path d="M12 1L6.5 6.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
  </svg>
)

const EditIcon = () => (
  <svg width="13" height="13" viewBox="0 0 13 13" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path d="M9.5 2L11 3.5L4.5 10H3V8.5L9.5 2Z" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/>
    <path d="M8 3.5L9.5 5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
  </svg>
)

const RefreshIcon = () => (
  <svg width="13" height="13" viewBox="0 0 13 13" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path d="M11 6.5a4.5 4.5 0 1 1-1.32-3.18" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
    <path d="M11 1.5V4H8.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/>
  </svg>
)

// A drawer/box with a downward arrow being filed into it.
const ArchiveIcon = () => (
  <svg width="13" height="13" viewBox="0 0 13 13" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path d="M2 6.5h9v3.5a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round"/>
    <path d="M5 8.3h3" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/>
    <path d="M6.5 1v3.6" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/>
    <path d="M4.7 2.9 6.5 4.7 8.3 2.9" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/>
  </svg>
)

// Same drawer, but the arrow points up and out — restoring an item.
const UnarchiveIcon = () => (
  <svg width="13" height="13" viewBox="0 0 13 13" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path d="M2 6.5h9v3.5a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round"/>
    <path d="M5 8.3h3" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/>
    <path d="M6.5 4.6V1" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/>
    <path d="M4.7 2.8 6.5 1 8.3 2.8" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/>
  </svg>
)

// A plain archive box (the noun) — used to label the archived section, not an action.
const ArchiveBoxIcon = () => (
  <svg width="13" height="13" viewBox="0 0 13 13" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path d="M1.5 3.5h10v2h-10z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round"/>
    <path d="M2.5 5.5h8v5a1 1 0 0 1-1 1h-6a1 1 0 0 1-1-1z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round"/>
    <path d="M5 8h3" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/>
  </svg>
)

const icons: Record<IconName, () => JSX.Element> = {
  'external-link': ExternalLinkIcon,
  'edit': EditIcon,
  'refresh': RefreshIcon,
  'archive': ArchiveIcon,
  'unarchive': UnarchiveIcon,
  'archive-box': ArchiveBoxIcon,
}

export default function Icon({ icon }: { icon: IconName }) {
  const Component = icons[icon]
  return <Component />
}
