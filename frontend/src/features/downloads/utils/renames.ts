import { t } from '@lingui/core/macro'
import { toast } from '@/services/toaster'
import type { Rename } from '../services/downloadServer'

// The server canonicalizes every submitted name for disk and reports what it changed. Adopting its
// spelling as the row's name is what keeps the green "already downloaded" row and a run's landed
// check comparing against what actually lands. `submitted` only names the change in the toast.
export function applyRenames(
  renames: Rename[] | undefined,
  submitted: { ref: string; name: string }[],
  setName: (ref: string, name: string) => void,
): void {
  if (!renames?.length) return
  for (const { ref, name } of renames) setName(ref, name)
  // One toast for more than one rename, without specific details.
  if (renames.length > 1) {
    const count = renames.length
    toast(
      'warning',
      t`Renamed ${count} downloads — some characters can't be used in a folder name.`,
    )
    return
  }

  // Single rename, so show the before and after in the toast.
  const { ref, name } = renames[0]
  const before = submitted.find((s) => s.ref === ref)?.name
  toast(
    'warning',
    before
      ? t`Renamed "${before}" to "${name}" — some characters can't be used in a folder name.`
      : t`Renamed to "${name}" — some characters can't be used in a folder name.`,
  )
}
