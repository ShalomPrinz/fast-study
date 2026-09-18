import type { Settings } from '@/services/settings'

export type RequiredField = 'geminiApiKey' | 'groqApiKey' | 'dataRoot' | 'gdriveRootFolder'

export interface RequiredInput {
  geminiKey: string
  geminiKeyStored: boolean
  groqKey: string
  groqKeyStored: boolean
  dataRoot: string
  dataRootConfirmed: boolean
  driveEnabled: boolean
  gdriveRootFolder: string
  // Passed in rather than read from `services/runtime`, so both functions here stay pure.
  canStoreApiKeys: boolean
}

/** The entries still missing. Shared by the init wall, which cannot be passed until this is empty,
 *  and the settings route, where only the Drive folder can ever go missing. */
export function missingEntries(input: RequiredInput): RequiredField[] {
  const missing: RequiredField[] = []
  // A machine that cannot store a key can never fill these in, so requiring them would leave the
  // wall with no way past it. The rest of the app works without them, so they stop being required.
  if (input.canStoreApiKeys) {
    // A key already in the store satisfies the entry: the field is write-only, so it renders blank.
    if (!input.geminiKey.trim() && !input.geminiKeyStored) missing.push('geminiApiKey')
    if (!input.groqKey.trim() && !input.groqKeyStored) missing.push('groqApiKey')
  }
  // The root is prefilled but never silently accepted, so an unconfirmed one counts as missing.
  if (!input.dataRoot.trim() || !input.dataRootConfirmed) missing.push('dataRoot')
  // Drive's folder has no default on purpose: turning Drive on reveals an empty required field.
  if (input.driveEnabled && !input.gdriveRootFolder.trim()) missing.push('gdriveRootFolder')
  return missing
}

/** The init wall's gate: both keys stored (where they can be) and a data root chosen. Language and
 *  Drive are asked on the wall but never required. */
export function isInitialized(settings: Settings, canStoreApiKeys: boolean): boolean {
  if (!settings.dataRoot) return false
  return !canStoreApiKeys || (settings.geminiApiKeySet && settings.groqApiKeySet)
}
