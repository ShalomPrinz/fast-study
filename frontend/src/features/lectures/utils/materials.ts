import type { MaterialInfo } from '@/types'

// The extensions Gemini reads, lower-case; null while the read is still out, when every material shows as supported.
export type SupportedExtensions = ReadonlySet<string> | null

// What a failed read falls back to: PDF is the one type that always worked.
export const FALLBACK_SUPPORTED: ReadonlySet<string> = new Set(['pdf'])

// Mirrors the backend's MAX_GEMINI_FILE_BYTES (backend/ `MAX_GEMINI_FILE_BYTES`), on-disk size.
export const MAX_GEMINI_FILE_BYTES = 10 * 1024 * 1024

// The disk name's lower-cased extension, no dot.
export function extensionOf(name: string): string {
  const dot = name.lastIndexOf('.')
  return dot < 0 ? '' : name.slice(dot + 1).toLowerCase()
}

// What the user knows the file as: the original name, or the disk name for one saved before it was kept.
export function displayName(m: MaterialInfo): string {
  return m.filename ?? m.name
}

// Whether Gemini can read this file type.
export function materialSupported(m: MaterialInfo, supported: SupportedExtensions): boolean {
  return supported === null || supported.has(extensionOf(m.name))
}

// Whether Summarize sends it: supported, and the user has not switched it off.
export function materialAttached(m: MaterialInfo, supported: SupportedExtensions): boolean {
  return materialSupported(m, supported) && (m.attach ?? true)
}

export function attachedMaterials(
  materials: MaterialInfo[],
  supported: SupportedExtensions,
): MaterialInfo[] {
  return materials.filter((m) => materialAttached(m, supported))
}

// An attached material over Gemini's size limit, which fails the whole Summarize.
export function materialTooLarge(m: MaterialInfo, supported: SupportedExtensions): boolean {
  return materialAttached(m, supported) && m.size > MAX_GEMINI_FILE_BYTES
}

// Whether the attached set now differs from the last summary's (toggle, download, delete); never
// while the support read is pending or failed, since the attached set can't be trusted then.
export function attachmentsChanged(
  summaryMaterials: string[],
  materials: MaterialInfo[],
  supported: SupportedExtensions,
): boolean {
  if (supported === null || supported === FALLBACK_SUPPORTED) return false
  const now = new Set(attachedMaterials(materials, supported).map((m) => m.name))
  const then = new Set(summaryMaterials)
  return now.size !== then.size || [...now].some((n) => !then.has(n))
}
