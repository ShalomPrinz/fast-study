import type { FileStatus, MaterialInfo, Step, TimingOperation } from '@/types'
import { STEP_INPUT_FILE } from '@/features/lectures/constants/pipeline'
import { isMaterialsOnly } from '@/features/lectures/utils/lectureProgress'

// The ETA bucket for a running step: its input file's size, except a summarize with no transcript
// on a materials-only lecture, which the backend times as `summarize_materials` over the attached materials' bytes.
export function timingKey(
  step: Step,
  files: FileStatus,
  // The attached set (`attachedMaterials`), the one the backend sends.
  materials: MaterialInfo[],
): { operation: TimingOperation; bytes: number } {
  if (
    step === 'summarize' &&
    !files['transcript.txt'].exists &&
    isMaterialsOnly(files, materials)
  ) {
    return {
      operation: 'summarize_materials',
      bytes: materials.reduce((sum, m) => sum + m.size, 0),
    }
  }
  const inputFile = STEP_INPUT_FILE[step]
  return { operation: step, bytes: inputFile ? (files[inputFile]?.size ?? 0) : 0 }
}
