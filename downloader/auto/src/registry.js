// Site -> { AuthProvider, CourseSource } pairing. Fixed for now (no swappable
// auth/site); a thin seam so adding a second university later is a one-line entry.
import { MicrosoftAuth } from './auth/MicrosoftAuth.js';
import { BiuCourseSource } from './sites/BiuCourseSource.js';

const SITES = [
  {
    id: 'biu',
    // PLACEHOLDER: adjust to the real BIU course host (see plan §9.1).
    matches: (u) => /(^|\.)biu\.ac\.il$/.test(new URL(u).hostname),
    auth: () => new MicrosoftAuth({ statePath: '.auth/biu.json' }),
    source: () => new BiuCourseSource(),
  },
];

/**
 * @param {string} courseUrl
 * @returns {{ auth: import('./auth/AuthProvider.js').AuthProvider, source: import('./sites/CourseSource.js').CourseSource }}
 */
export function resolveSite(courseUrl) {
  const site = SITES.find((s) => s.matches(courseUrl));
  if (!site) throw new Error(`No site handler for ${courseUrl}`);
  return { auth: site.auth(), source: site.source() };
}
