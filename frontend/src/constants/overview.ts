export const GENERATED_SUFFIXES = ['.txt', '.md', '.pdf'] as const

export const LAST_FILE_SUFFIX = GENERATED_SUFFIXES[GENERATED_SUFFIXES.length - 1]

export function generatedFiles(slug: string): string[] {
  return GENERATED_SUFFIXES.map((suffix) => `${slug}${suffix}`)
}

export function lastGeneratedFile(slug: string): string {
  return `${slug}${LAST_FILE_SUFFIX}`
}

export interface StartedSlug {
  furthest: string // furthest pipeline output already on disk
  willRegenerate: string[] // every file up to and including it — what a re-run overwrites
}

// How far along a slug is, given the set of existing overview filenames.
// Returns null when nothing was produced yet — that's fresh generation, not a re-generation.
export function startedSlug(slug: string, existing: Set<string>): StartedSlug | null {
  const produced = generatedFiles(slug)
  let furthestIdx = -1
  produced.forEach((name, i) => {
    if (existing.has(name)) furthestIdx = i
  })
  if (furthestIdx === -1) return null
  return { furthest: produced[furthestIdx], willRegenerate: produced.slice(0, furthestIdx + 1) }
}
