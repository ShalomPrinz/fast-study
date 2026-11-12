import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import './Sidebar.css'

// The class of a sidebar nav row, shared by the link rows and the Lectures button.
export function rowClass(active: boolean): string {
  return `sidebar-nav-row${active ? ' active' : ''}`
}

// A sidebar route row.
export default function SidebarLink({
  to,
  active,
  children,
}: {
  to: string
  active: boolean
  children: ReactNode
}) {
  return (
    <Link className={rowClass(active)} to={to}>
      {children}
    </Link>
  )
}
