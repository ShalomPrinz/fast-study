import type { FileName, FileStatus, Lecture, MaterialInfo, RemovableFile } from '@/types'
import { PIPELINE } from '@/features/lectures/constants/pipeline'

// The files map every rule below reads: a removed file counts as present, mirroring the
// backend's `_mark_removed`, so a lecture stripped after its PDF never looks undone or materials-only.
export function markRemoved(files: FileStatus, removed: RemovableFile[]): FileStatus {
  if (removed.length === 0) return files
  const marked = { ...files }
  for (const name of removed) marked[name] = { ...files[name], exists: true }
  return marked
}

// Whether a lecture holds this file, on disk or removed.
export function holdsFile(lecture: Pick<Lecture, 'files' | 'removed'>, file: FileName): boolean {
  return lecture.files[file].exists || (lecture.removed as FileName[]).includes(file)
}

// Done once the last output exists (`drive_url.txt`, or `summary.pdf` with Drive off), mirroring
// the backend's `final_output()`.
export function filesComplete(files: FileStatus, driveEnabled: boolean): boolean {
  return files[driveEnabled ? 'drive_url.txt' : 'summary.pdf'].exists
}

export function isLectureComplete(lecture: Lecture, driveEnabled: boolean): boolean {
  return filesComplete(lecture.files, driveEnabled)
}

// Every rule from here on takes the `markRemoved` map, and `materials` is the attached set
// (`attachedMaterials`) — a material Summarize would not send does not make a lecture materials-only.

// No video.mp4, no audio.mp3 and at least one attached material: summarized from the materials alone,
// mirroring the backend's `is_materials_only()` / `_summarize_source()`.
export function isMaterialsOnly(files: FileStatus, materials: MaterialInfo[]): boolean {
  return !files['video.mp4'].exists && !files['audio.mp3'].exists && materials.length > 0
}

// A summary made from the materials alone — derived from files only, there is no marker.
export function summarizedFromMaterials(files: FileStatus, materials: MaterialInfo[]): boolean {
  return (
    files['summary.md'].exists &&
    !files['transcript.txt'].exists &&
    isMaterialsOnly(files, materials)
  )
}

const SKIPPABLE: FileName[] = ['video.mp4', 'audio.mp3', 'transcript.txt']

// A materials-only lecture skips the video, audio and transcript stages; one whose file is
// nonetheless there still shows it.
export function skippedStage(
  file: FileName,
  files: FileStatus,
  materials: MaterialInfo[],
): boolean {
  return SKIPPABLE.includes(file) && !files[file].exists && isMaterialsOnly(files, materials)
}

// Whether a stage's step has its input; summarize also runs off a materials-only lecture's materials.
export function stagePrereqMet(
  stage: { file: FileName; prereq?: FileName },
  files: FileStatus,
  materials: MaterialInfo[],
): boolean {
  if (!stage.prereq || files[stage.prereq].exists) return true
  return stage.file === 'summary.md' && isMaterialsOnly(files, materials)
}

// Whether Run Remaining would do anything: the backend's `next_step` (the first enabled, non-skipped
// step whose output is missing, none once complete) must exist and have its input, or the run fails.
export function canRunRemaining(
  files: FileStatus,
  materials: MaterialInfo[],
  driveEnabled: boolean,
): boolean {
  if (filesComplete(files, driveEnabled)) return false
  const next = PIPELINE.find(
    (p) =>
      p.step &&
      (driveEnabled || p.step !== 'drive') &&
      !files[p.file].exists &&
      !skippedStage(p.file, files, materials),
  )
  return !!next && stagePrereqMet(next, files, materials)
}
