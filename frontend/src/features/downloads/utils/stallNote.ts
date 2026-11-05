import type { JobSource } from '@/features/downloads/services/downloadServer'
import { choiceForSite } from '@/features/settings/utils/moodleSites'

export type StallWho = 'lemida' | 'university' | 'server'

// Who the "responding slowly" note blames: a Moodle job names the saved university (Lemida for the
// BIU preset), anything else the server.
export function stallWho(source: JobSource, savedSite: string | null | undefined): StallWho {
  if (source !== 'moodle') return 'server'
  return choiceForSite(savedSite ?? null) === 'biu' ? 'lemida' : 'university'
}

const latched = new Set<string>()

// Whether the note shows: once a running job was seen stalled it stays for that id, so a slow site
// trickling a chunk every 30 s does not flicker it. Ends with the job leaving `running`; a restart is a new id.
export function stallLatched(job: { id: string; status: string; stalled: boolean }): boolean {
  if (job.status !== 'running') {
    latched.delete(job.id)
    return false
  }
  if (job.stalled) latched.add(job.id)
  return latched.has(job.id)
}
