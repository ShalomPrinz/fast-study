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
}

/** The entries still missing. Shared by the init wall, which cannot be passed until this is empty,
 *  and the settings route, where only the Drive folder can ever go missing. */
export function missingEntries(input: RequiredInput): RequiredField[] {
  const missing: RequiredField[] = []
  // A key already in the store satisfies the entry: the field is write-only, so it renders blank.
  if (!input.geminiKey.trim() && !input.geminiKeyStored) missing.push('geminiApiKey')
  if (!input.groqKey.trim() && !input.groqKeyStored) missing.push('groqApiKey')
  // The root is prefilled but never silently accepted, so an unconfirmed one counts as missing.
  if (!input.dataRoot.trim() || !input.dataRootConfirmed) missing.push('dataRoot')
  // Drive's folder has no default on purpose: turning Drive on reveals an empty required field.
  if (input.driveEnabled && !input.gdriveRootFolder.trim()) missing.push('gdriveRootFolder')
  return missing
}
