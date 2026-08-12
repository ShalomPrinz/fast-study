import { Link } from 'react-router-dom'

export default function NotFoundPanel({ message }: { message: string }) {
  return (
    <main className="main-view main-view--empty">
      <p className="empty-state" dir="auto">
        {message}
      </p>
      <Link className="empty-state-link" to="/">
        Home
      </Link>
    </main>
  )
}
