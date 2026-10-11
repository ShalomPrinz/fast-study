export type SourceChangeAction = 'reload' | 'close' | 'none'

// What a saved source-URL edit does to the recordings panel: only the course loaded or loading
// follows it — closed, then reloaded from the new URL unless the URL was cleared.
export function sourceChangeAction(
  loaded: boolean,
  loading: boolean,
  oldUrl: string,
  newUrl: string,
): SourceChangeAction {
  if (oldUrl === newUrl || !(loaded || loading)) return 'none'
  return newUrl ? 'reload' : 'close'
}
