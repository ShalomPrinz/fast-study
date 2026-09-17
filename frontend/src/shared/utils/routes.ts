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
