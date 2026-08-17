// Reject path-traversal / separator characters so a name can only ever be a
// single on-disk segment.
function isSingleSegment(name) {
  return (
    typeof name === 'string' &&
    name.length > 0 &&
    !name.includes('/') &&
    !name.includes('\\') &&
    name !== '.' &&
    name !== '..'
  );
}

// Windows rejects these in a path component; device names are reserved with or without an
// extension. Leaves headroom under MAX_PATH.
const ILLEGAL_NAME_CHARS = new Set([
  ...'<>:"/\\|?*',
  ...Array.from({ length: 32 }, (_, c) => String.fromCharCode(c)),
]);
const RESERVED_NAMES = new Set([
  'CON',
  'PRN',
  'AUX',
  'NUL',
  ...['COM', 'LPT'].flatMap((p) => [...'123456789¹²³'].map((i) => `${p}${i}`)),
]);
const MAX_NAME_LEN = 80;

// Port of `database/fs/paths.py::safe_name`, which is the authority — change one, change the
// other. Applied at this server's request boundary so a caller learns the spelling the database
// will actually store, instead of comparing its own against a tree that silently differs.
// Answers '' where the Python raises (no legal characters left), which `storedName` maps to null.
function canonicalize(name) {
  const kept = [...name]
    .filter((c) => !ILLEGAL_NAME_CHARS.has(c))
    .join('')
    .trim();
  // Windows silently strips trailing dots and spaces, which would desync the name from disk.
  const cleaned = [...kept]
    .slice(0, MAX_NAME_LEN)
    .join('')
    .replace(/[. ]+$/, '');
  return RESERVED_NAMES.has(cleaned.split('.')[0].toUpperCase()) ? `${cleaned}_` : cleaned;
}

// The spelling the database will store, or null when the name can't become one. The segment check
// MUST run first: `canonicalize` drops '/' as an illegal character, so 'a/b' would quietly collapse
// to 'ab' instead of being rejected as traversal.
export function storedName(name) {
  return isSingleSegment(name) ? canonicalize(name) || null : null;
}

// null when valid, else the 400 body. kind selects lecture vs Recitations layout.
export function validateKind(kind) {
  if (kind !== 'lecture' && kind !== 'recitation') return { error: `invalid kind: ${kind}` };
  return null;
}
