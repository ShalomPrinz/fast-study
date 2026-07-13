import { resolveUniversity, resolveExtractor, resolveExtractorForRecording } from './registry.js';
import { postDownload, postDownloadYoutube } from './serverClient.js';
import { parseZoomSections } from './extractors/zoomSection.js';
import { expandTiles } from './extractors/moodleCourse.js';
import { splitName } from './naming.js';

/**
 * LISTING PATH: enumerate a navigated course page's recordings, each paired with
 * the extractor that resolves it (the pairing is what the CLI download loop needs;
 * the HTTP layer keeps only the recordings and re-resolves the extractor later).
 * The page must already be at `courseUrl` — the caller owns navigation + auth.
 * @param {import('playwright').Page} page
 * @param {string} courseUrl
 * @returns {Promise<{ recording: import('./extractors/VideoExtractor.js').Recording,
 *                     extractor: import('./extractors/VideoExtractor.js').VideoExtractor }[]>}
 */
export async function listRecordings(page, courseUrl) {
  const uni = resolveUniversity(courseUrl);
  // format_tiles defers each section's body until its tile is clicked, so both
  // parsers below would see an empty page — expand every tile first.
  await expandTiles(page);
  // Two DOM sources merge here (the single merge point): the LMS's `li.activity`
  // module cards, plus zoom-share links living in `li.section` summaries (which
  // aren't activity cards, so the module parser never sees them).
  const activities = [...(await uni.parse(page)), ...(await parseZoomSections(page))];
  const items = [];
  for (const activity of activities) {
    const extractor = resolveExtractor(activity);
    if (!extractor) continue;
    for (const recording of extractor.toRecordings(activity)) items.push({ recording, extractor });
  }
  return items;
}

/**
 * DOWNLOAD PATH (HTTP): resolve one echoed-back recording and hand it to server.js.
 *  - videostream: navigate + sniff the .mp4 fresh on the shared page (tokens are
 *    short-lived) → POST /download.
 *  - youtube entry: already carries its direct url (the playlist was expanded via
 *    /playlist/entries) → POST /download-youtube, no navigation.
 * @param {import('playwright').Page|null} page  live shared page (null for youtube entries)
 * @param {{ recording: import('./extractors/VideoExtractor.js').Recording,
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

  // Zoom yields 1-or-2 captures (a share link can hold a before/after-break pair).
  // Split into `<name>.1`/`<name>.2` ONLY when a distinct second .mp4 was captured;
  // a lone recording keeps the plain `<name>`.
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
