// Non-fatal marker on the summary.pdf row: the PDF opened fine, but part of it may render wrong.
// Styled like MaterialIndicator; the full message is the tooltip, since it is a long one-liner.
export default function PdfWarningBadge({ warning }: { warning?: string }) {
  if (!warning) return null

  return (
    <span className="file-slot pdf-warning-indicator" title={warning} role="status">
      <span className="pdf-warning-symbol">⚠</span>
    </span>
  )
}
