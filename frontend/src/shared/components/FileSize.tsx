import { formatBytes } from '@/shared/utils/format'

// Forces LTR so "395 B" keeps its number-then-unit order inside RTL text.
export function FileSize({ bytes }: { bytes: number }) {
  return <bdi dir="ltr">{formatBytes(bytes)}</bdi>
}
