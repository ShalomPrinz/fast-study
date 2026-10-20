// The segment a switch shows: the chosen one while `modes` still holds it, else the first (default).
export function effectiveMode<M extends string>(modes: Partial<Record<M, unknown>>, mode: M): M {
  return mode in modes ? mode : (Object.keys(modes)[0] as M)
}

// The choice a switch starts with: any stored key, even one `modes` hides now, so it returns with its
// segment; `effectiveMode` covers the display meanwhile. Nothing stored starts on the first mode.
export function storedMode<M extends string>(
  stored: string | null,
  modes: Partial<Record<M, unknown>>,
): M {
  return stored ? (stored as M) : (Object.keys(modes)[0] as M)
}
