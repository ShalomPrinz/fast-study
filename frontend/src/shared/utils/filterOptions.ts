// A combobox's options: all of them until the text is edited since the list opened, so a prefilled
// value never hides the others; after an edit, those containing the text, ignoring case.
export function filterOptions(
  options: readonly string[],
  text: string,
  edited: boolean,
): readonly string[] {
  const key = text.trim().toLowerCase()
  return edited ? options.filter((o) => o.toLowerCase().includes(key)) : options
}
