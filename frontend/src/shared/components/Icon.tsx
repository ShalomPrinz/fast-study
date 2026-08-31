export type IconName =
  | 'external-link'
  | 'edit'
  | 'archive'
  | 'unarchive'
  | 'archive-box'
  | 'search'
  | 'lecture'
  | 'nav-lectures'
  | 'nav-courses'
  | 'nav-downloads'
  | 'nav-search'
  | 'nav-settings'
  | 'rotate'
  | 'trash'
  | 'overflow'
  | 'file'
  | 'chevron-start'
  | 'chevron-end'
  | 'chevron-down'
  | 'warning'
  | 'check'

const ExternalLinkIcon = () => (
  <svg width="13" height="13" viewBox="0 0 13 13" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path
      d="M5 2H2a1 1 0 0 0-1 1v8a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1V8"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
    />
    <path
      d="M8 1h4v4"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
    <path d="M12 1L6.5 6.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
  </svg>
)

const EditIcon = () => (
  <svg width="13" height="13" viewBox="0 0 13 13" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path
      d="M9.5 2L11 3.5L4.5 10H3V8.5L9.5 2Z"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
    <path d="M8 3.5L9.5 5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
  </svg>
)

// A drawer/box with a downward arrow being filed into it.
const ArchiveIcon = () => (
  <svg width="13" height="13" viewBox="0 0 13 13" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path
      d="M2 6.5h9v3.5a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1z"
      stroke="currentColor"
      strokeWidth="1.2"
      strokeLinejoin="round"
    />
    <path d="M5 8.3h3" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
    <path d="M6.5 1v3.6" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
    <path
      d="M4.7 2.9 6.5 4.7 8.3 2.9"
      stroke="currentColor"
      strokeWidth="1.2"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
)

// Same drawer, but the arrow points up and out — restoring an item.
const UnarchiveIcon = () => (
  <svg width="13" height="13" viewBox="0 0 13 13" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path
      d="M2 6.5h9v3.5a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1z"
      stroke="currentColor"
      strokeWidth="1.2"
      strokeLinejoin="round"
    />
    <path d="M5 8.3h3" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
    <path d="M6.5 4.6V1" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
    <path
      d="M4.7 2.8 6.5 1 8.3 2.8"
      stroke="currentColor"
      strokeWidth="1.2"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
)

// A plain archive box (the noun) — used to label the archived section, not an action.
const ArchiveBoxIcon = () => (
  <svg width="13" height="13" viewBox="0 0 13 13" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path d="M1.5 3.5h10v2h-10z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
    <path
      d="M2.5 5.5h8v5a1 1 0 0 1-1 1h-6a1 1 0 0 1-1-1z"
      stroke="currentColor"
      strokeWidth="1.2"
      strokeLinejoin="round"
    />
    <path d="M5 8h3" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
  </svg>
)

const SearchIcon = () => (
  <svg width="13" height="13" viewBox="0 0 13 13" fill="none" xmlns="http://www.w3.org/2000/svg">
    <circle cx="5.5" cy="5.5" r="4" stroke="currentColor" strokeWidth="1.4" />
    <path d="M8.5 8.5L11.5 11.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
  </svg>
)

// A lecture: a frame with a play mark. Sized larger than the row icons — it labels an empty state.
const LectureIcon = () => (
  <svg width="19" height="19" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path d="M2.5 3.5h11v9h-11z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
    <path d="M6 6.5l3.5 2L6 10.5z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
  </svg>
)

// The four sidebar nav glyphs share a 16px box so they line up down the rail, one size above the
// 13px row icons that sit inside text.
const NavLecturesIcon = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path d="M2.5 3.5h11v9h-11z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
    <path d="M6 6.5l3.5 2L6 10.5z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
  </svg>
)

// Four panes — a course is a grid of parts, against the lecture's single frame.
const NavCoursesIcon = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path
      d="M3 3h4.5v4.5H3zM8.5 3H13v4.5H8.5zM3 8.5h4.5V13H3zM8.5 8.5H13V13H8.5z"
      stroke="currentColor"
      strokeWidth="1.3"
      strokeLinejoin="round"
    />
  </svg>
)

const NavDownloadsIcon = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path d="M8 2.5v8" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
    <path
      d="M5 7.5L8 10.5 11 7.5"
      stroke="currentColor"
      strokeWidth="1.3"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
    <path d="M3 13h10" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
  </svg>
)

// A gear — the settings destination, at the same 16px box as its four nav siblings.
const NavSettingsIcon = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
    <circle cx="8" cy="8" r="2.4" stroke="currentColor" strokeWidth="1.3" />
    <circle cx="8" cy="8" r="5" stroke="currentColor" strokeWidth="1.3" />
    <path
      d="M8 1.3v1.7M8 13v1.7M1.3 8h1.7M13 8h1.7M3.2 3.2l1.2 1.2M11.6 11.6l1.2 1.2M12.8 3.2l-1.2 1.2M4.4 11.6l-1.2 1.2"
      stroke="currentColor"
      strokeWidth="1.3"
      strokeLinecap="round"
    />
  </svg>
)

const NavSearchIcon = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
    <circle cx="7" cy="7" r="4.5" stroke="currentColor" strokeWidth="1.3" />
    <path d="M10.5 10.5L14 14" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
  </svg>
)

// Counter-clockwise arrow — re-run a step that already produced its file.
const RotateIcon = () => (
  <svg width="13" height="13" viewBox="0 0 13 13" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path
      d="M2 6.5a4.5 4.5 0 1 0 1.5-3.35"
      stroke="currentColor"
      strokeWidth="1.3"
      strokeLinecap="round"
    />
    <path
      d="M1.6 1.4v2.4h2.4"
      stroke="currentColor"
      strokeWidth="1.3"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
)

const TrashIcon = () => (
  <svg width="13" height="13" viewBox="0 0 13 13" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path d="M1.8 3.2h9.4" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
    <path
      d="M4.6 3.2V2a.6.6 0 0 1 .6-.6h2.6a.6.6 0 0 1 .6.6v1.2"
      stroke="currentColor"
      strokeWidth="1.2"
      strokeLinejoin="round"
    />
    <path
      d="M3 3.2h7l-.5 7.3a1 1 0 0 1-1 .9H4.5a1 1 0 0 1-1-.9z"
      stroke="currentColor"
      strokeWidth="1.2"
      strokeLinejoin="round"
    />
  </svg>
)

// Vertical ellipsis: the menu holding the actions a row no longer shows inline.
const OverflowIcon = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
    <circle cx="8" cy="3" r="1.2" fill="currentColor" />
    <circle cx="8" cy="8" r="1.2" fill="currentColor" />
    <circle cx="8" cy="13" r="1.2" fill="currentColor" />
  </svg>
)

// A dog-eared page — labels a material chip.
const FileIcon = () => (
  <svg width="13" height="13" viewBox="0 0 13 13" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path
      d="M3 1.5h4l3 3v7a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1v-9a1 1 0 0 1 1-1z"
      stroke="currentColor"
      strokeWidth="1.2"
      strokeLinejoin="round"
    />
    <path d="M7 1.5v3h3" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
  </svg>
)

// Points backwards along the reading direction, so a Hebrew page must mirror it in CSS.
const ChevronStartIcon = () => (
  <svg width="14" height="14" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path
      d="M9.5 3.5L5 8l4.5 4.5"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
)

// Points onward along the reading direction, so like `chevron-start` it mirrors in Hebrew.
const ChevronEndIcon = () => (
  <svg width="13" height="13" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path
      d="M6.5 3.5L11 8l-4.5 4.5"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
)

// Vertical, so unlike `chevron-start` it needs no mirroring in a right-to-left page.
const ChevronDownIcon = () => (
  <svg width="14" height="14" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path
      d="M3.5 6L8 10.5L12.5 6"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
)

// Warning triangle — labels a non-fatal state, never a failure.
const WarningIcon = () => (
  <svg width="11" height="11" viewBox="0 0 12 12" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path d="M6 1.8l4.4 7.6H1.6z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
    <path d="M6 5v2" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
  </svg>
)

// The done tick, at chip scale — the same stroke `StatusNode` draws inside its 22px node.
const CheckIcon = () => (
  <svg width="12" height="12" viewBox="0 0 12 12" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path
      d="M2.5 6.2l2.4 2.4L9.5 4"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
)

const icons: Record<IconName, () => JSX.Element> = {
  'external-link': ExternalLinkIcon,
  edit: EditIcon,
  archive: ArchiveIcon,
  unarchive: UnarchiveIcon,
  'archive-box': ArchiveBoxIcon,
  search: SearchIcon,
  lecture: LectureIcon,
  'nav-lectures': NavLecturesIcon,
  'nav-courses': NavCoursesIcon,
  'nav-downloads': NavDownloadsIcon,
  'nav-search': NavSearchIcon,
  'nav-settings': NavSettingsIcon,
  rotate: RotateIcon,
  trash: TrashIcon,
  overflow: OverflowIcon,
  file: FileIcon,
  'chevron-start': ChevronStartIcon,
  'chevron-end': ChevronEndIcon,
  'chevron-down': ChevronDownIcon,
  warning: WarningIcon,
  check: CheckIcon,
}

export default function Icon({ icon }: { icon: IconName }) {
  const Component = icons[icon]
  return <Component />
}
