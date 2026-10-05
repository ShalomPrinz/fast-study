interface RenameFlow {
  typed: string
  rename: () => Promise<string>
  refresh: () => Promise<void>
  follow: (effective: string) => void
  show: (label: string | null) => void
}

// The row shows the new name from Enter until the refreshed tree lands, and the open page follows only
// then, so it never asks for the new name before the tree holds it.
export async function renameAndFollow({ typed, rename, refresh, follow, show }: RenameFlow) {
  show(typed)
  let effective: string
  try {
    effective = await rename()
  } catch (e) {
    show(null)
    throw e
  }
  show(effective)
  await refresh()
  follow(effective)
  show(null)
}
