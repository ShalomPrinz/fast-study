import { resolveUniversity, resolveExtractor, resolveExtractorForRecording } from './registry.js';
import { postDownload, postDownloadYoutube } from './serverClient.js';

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
  const activities = await uni.parse(page);
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
  const cap = await extractor.captureVideo(page, recording);
  await postDownload({ url: cap.url, headers: cap.headers, course, lecture: name, kind });
}
