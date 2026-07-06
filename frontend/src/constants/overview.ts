export const LAST_FILE_SUFFIX = '-analyzed.pdf'

export function lastGeneratedFile(slug: string): string {
  return `${slug}${LAST_FILE_SUFFIX}`
}
