import type { Step, FileName } from '@/types'

export const PIPELINE: Array<{
  file: FileName
  step?: Step
  actionLabel?: string
  prereq?: FileName
}> = [
  { file: 'video.mp4' },
  { file: 'audio.mp3', step: 'audio', actionLabel: 'Extract Audio', prereq: 'video.mp4' },
  { file: 'transcript.txt', step: 'transcribe', actionLabel: 'Transcribe', prereq: 'audio.mp3' },
  { file: 'summary.md', step: 'summarize', actionLabel: 'Summarize', prereq: 'transcript.txt' },
  { file: 'summary.pdf', step: 'pdf', actionLabel: 'Export PDF', prereq: 'summary.md' },
  { file: 'drive_url.txt', step: 'drive', actionLabel: 'Upload to Drive', prereq: 'summary.pdf' },
]

const STEP_FILE_MUT: Partial<Record<Step, FileName>> = {}
const STEP_INPUT_FILE_MUT: Partial<Record<Step, FileName>> = {}
const STEP_LABEL_MUT: Partial<Record<Step, string>> = {}
const STEP_SET_MUT = new Set<string>()

for (const p of PIPELINE) {
  if (!p.step) continue
  STEP_FILE_MUT[p.step] = p.file
  if (p.prereq) STEP_INPUT_FILE_MUT[p.step] = p.prereq
  if (p.actionLabel) STEP_LABEL_MUT[p.step] = p.actionLabel
  STEP_SET_MUT.add(p.step)
}

export const STEP_FILE: Partial<Record<Step, FileName>> = STEP_FILE_MUT
export const STEP_INPUT_FILE: Partial<Record<Step, FileName>> = STEP_INPUT_FILE_MUT
export const STEP_LABEL: Partial<Record<Step, string>> = STEP_LABEL_MUT
export const STEP_SET: Set<string> = STEP_SET_MUT

export const STEP_ERROR_LABEL: Record<Step, string> = {
  audio: 'Audio extraction failed',
  transcribe: 'Transcription failed',
  summarize: 'Summarization failed',
  pdf: 'PDF export failed',
  drive: 'Drive upload failed',
}
