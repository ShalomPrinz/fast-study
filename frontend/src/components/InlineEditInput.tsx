import type { InlineEdit } from '@/types'

interface Props {
  edit: InlineEdit
  onCommit: () => void
  onCancel: () => void
  placeholder?: string
  className?: string
}

export default function InlineEditInput({
  edit,
  onCommit,
  onCancel,
  placeholder,
  className = 'lecture-add-input',
}: Props) {
  return (
    <input
      ref={edit.ref}
      className={className}
      value={edit.value}
      onChange={(e) => edit.setValue(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') onCommit()
        if (e.key === 'Escape') onCancel()
      }}
      onBlur={onCancel}
      placeholder={placeholder}
      dir="auto"
    />
  )
}
