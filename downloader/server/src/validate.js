// Reject path-traversal / separator characters so a name can only ever be a
// single on-disk segment.
export function isSafeName(name) {
  return (
    typeof name === 'string' &&
    name.length > 0 &&
    !name.includes('/') &&
    !name.includes('\\') &&
    name !== '.' &&
    name !== '..'
  );
}

// null when valid, else the 400 body. kind selects lecture vs Recitations layout.
export function validateKind(kind) {
  if (kind !== 'lecture' && kind !== 'recitation') return { error: `invalid kind: ${kind}` };
  return null;
}
