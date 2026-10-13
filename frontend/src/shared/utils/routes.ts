// The browser route patterns App.tsx declares; also fed to useMatch/matchPath so they cannot drift.
export const ROUTES = {
  overview: '/course/:course/overview',
  lecture: '/:course/:lecture',
  editor: '/:course/:lecture/edit',
  downloads: '/downloads',
  search: '/search',
  running: '/running',
  settings: '/settings',
} as const

// A matched name param as the name it was built from. React Router turns a literal `%2F` in a decoded
// segment into `/`; a name never holds `/` (the database strips it), so every `/` here was a `%2F`.
export function routeParam(value: string | undefined): string {
  return (value ?? '').replace(/\//g, '%2F')
}
