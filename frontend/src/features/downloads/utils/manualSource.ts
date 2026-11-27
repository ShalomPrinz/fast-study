export type ManualSource = 'link' | 'file'

export const MANUAL_SOURCE_KEY = 'fastStudyManualSource'

// Link unless the user last chose File; anything unreadable falls back to Link.
export function storedSource(raw: string | null): ManualSource {
  return raw === 'file' ? 'file' : 'link'
}

export function readSource(): ManualSource {
  try {
    return storedSource(localStorage.getItem(MANUAL_SOURCE_KEY))
  } catch {
    return 'link'
  }
}

export function writeSource(source: ManualSource): void {
  try {
    localStorage.setItem(MANUAL_SOURCE_KEY, source)
  } catch {
    // Storage blocked: the choice lasts this visit only.
  }
}
