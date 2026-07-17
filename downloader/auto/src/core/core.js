import { resolveUniversity, resolveExtractor, resolveExtractorForRecording } from './registry.js';
import { postDownload, postDownloadYoutube } from '../http/serverClient.js';
import { parseZoomSections } from '../discovery/zoomSection.js';
import { expandTiles } from '../discovery/moodleCourse.js';
import { splitName } from '../lib/naming.js';

/**
 * LISTING PATH: enumerate a navigated course page's recordings (caller owns nav + auth).
 * See docs/BROWSING.md.
 * @param {import('playwright').Page} page
 * @param {string} courseUrl
 * @returns {Promise<import('../extractors/VideoExtractor.js').Recording[]>}
 */
export async function listRecordings(page, courseUrl) {
  const uni = resolveUniversity(courseUrl);
  // format_tiles defers each section's body until its tile is clicked — expand first.
  await expandTiles(page);
  // Single merge point: `li.activity` module cards + zoom-share links in `li.section`
  // summaries (not activity cards, so the module parser never sees them).
  const activities = [...(await uni.parse(page)), ...(await parseZoomSections(page))];
  const recordings = [];
  for (const activity of activities) {
    const extractor = resolveExtractor(activity);
    if (!extractor) continue;
    for (const recording of extractor.toRecordings(activity)) recordings.push(recording);
  }
  return recordings;
}

/**
 * DOWNLOAD PATH (HTTP): resolve one echoed-back recording and hand it to server/.
 * videostream/zoom sniff the .mp4 fresh on the shared page; a youtube entry carries its
 * direct url (no navigation). See docs/BROWSING.md.
 * @param {import('playwright').Page|null} page  live shared page (null for youtube entries)
 * @param {{ recording: import('../extractors/VideoExtractor.js').Recording,
 *           course: string, name: string, kind: string }} args
 */
export async function downloadRecording(page, { recording, course, name, kind }) {
  if (recording.strategy === 'youtube-playlist') {
    if (!recording.url) throw new Error('expand the playlist and download a specific entry');
    await postDownloadYoutube({ url: recording.url, course, lecture: name, kind });
    return;
  }
  const extractor = resolveExtractorForRecording(recording);
  if (!extractor) throw new Error(`no extractor for strategy ${recording.strategy}`);

  // Zoom yields 1-or-2 captures (before/after-break pair). Split into `<name>.1`/`<name>.2`
  // only when a distinct second .mp4 was captured; a lone recording keeps `<name>`.
  if (recording.strategy === 'zoom') {
    const caps = await extractor.captureVideo(page, recording);
    const names = caps.length === 2 ? [splitName(name, 1), splitName(name, 2)] : [name];
    for (let i = 0; i < caps.length; i++) {
      await postDownload({ url: caps[i].url, headers: caps[i].headers, course, lecture: names[i], kind });
    }
    return;
  }

  const cap = await extractor.captureVideo(page, recording);
  await postDownload({ url: cap.url, headers: cap.headers, course, lecture: name, kind });
}
