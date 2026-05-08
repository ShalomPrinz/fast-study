export type IconName = 'external-link' | 'edit'

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

const icons: Record<IconName, () => JSX.Element> = {
  'external-link': ExternalLinkIcon,
  'edit': EditIcon,
}

export default function Icon({ icon }: { icon: IconName }) {
  const Component = icons[icon]
  return <Component />
}
