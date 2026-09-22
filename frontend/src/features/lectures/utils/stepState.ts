import type { RunError } from '@/types'
import type { StatusNodeState } from '@/shared/components/StatusNode'
import { isGeminiQuota } from '@/shared/utils/runError'

// A pipeline row's glyph: the file wins, then a running step, then the lecture's last error when its
// `step` names this row — the backend's word, never a guess from which file is missing.
export function stepState(
  exists: boolean,
  isRunning: boolean,
  step: string | undefined,
  error: RunError | null,
): StatusNodeState {
  if (exists) return 'done'
  if (isRunning) return 'running'
  if (step && error?.step === step) return isGeminiQuota(error.code) ? 'quota' : 'failed'
  return 'pending'
}
