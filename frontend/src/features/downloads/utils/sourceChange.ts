export type SourceChangeAction = 'reload' | 'close' | 'none'

// What a saved source-URL edit does to the picked course: a new URL loads it (replacing whatever
// was open), a cleared one closes it only if its recordings are loaded or loading.
export function sourceChangeAction(
  loaded: boolean,
  loading: boolean,
  oldUrl: string,
  newUrl: string,
): SourceChangeAction {
  if (oldUrl === newUrl) return 'none'
  if (newUrl) return 'reload'
  return loaded || loading ? 'close' : 'none'
}
