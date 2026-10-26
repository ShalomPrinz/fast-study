import { fetchSupportedMaterials } from '@/services/backend'
import { FALLBACK_SUPPORTED } from '@/features/lectures/utils/materials'

// The boot read of which material types Gemini accepts; a failed read leaves PDF alone supported.
export async function loadSupportedMaterials(): Promise<ReadonlySet<string>> {
  try {
    return new Set((await fetchSupportedMaterials()).map((e) => e.toLowerCase()))
  } catch {
    return FALLBACK_SUPPORTED
  }
}
