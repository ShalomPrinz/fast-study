interface RenameFlow {
  typed: string
  rename: () => Promise<string>
  // Settles once a tree holding `effective` is applied, or the refetch it starts settles without one.
  refresh: (effective: string) => Promise<void>
  follow: (effective: string) => void
  show: (label: string | null) => void
}

// The row shows the new name from Enter until a tree holding it lands, and the open page follows in that
// same render, so it never asks for the new name before the tree holds it, nor the old one after.
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
  await refresh(effective)
  follow(effective)
  show(null)
}
