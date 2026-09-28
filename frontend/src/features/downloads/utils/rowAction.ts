// What a single row's download button shows. An unsupported row's button is disabled, so it reads
// "Download" rather than offering a Retry that no retry could satisfy.
export type RowAction = 'pending' | 'retry' | 'done' | 'download'

export function rowAction(row: {
  pending: boolean
  unsupported: boolean
  failed: boolean
  done: boolean
}): RowAction {
  if (row.pending) return 'pending'
  if (row.unsupported) return 'download'
  if (row.failed) return 'retry'
  return row.done ? 'done' : 'download'
}
