export const GENERATED_SUFFIXES = ['.txt', '.md', '.pdf'] as const

export const LAST_FILE_SUFFIX = GENERATED_SUFFIXES[GENERATED_SUFFIXES.length - 1]

export function generatedFiles(slug: string): string[] {
  return GENERATED_SUFFIXES.map((suffix) => `${slug}${suffix}`)
}

export function lastGeneratedFile(slug: string): string {
  return `${slug}${LAST_FILE_SUFFIX}`
}
