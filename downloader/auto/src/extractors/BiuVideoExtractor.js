import { VideoExtractor } from './VideoExtractor.js';

// BIU's object store, where its sidebar video block keeps every file as `video_bucket/<filename>.mp4`.
export const BIU_VIDEO_HOST =
  'https://axt1t2yu790u.compat.objectstorage.il-jerusalem-1.oraclecloud.com';

/** The bucket URL of a block entry's `filename` key, or null when it is not a plain object key. */
export function biuVideoUrl(objectKey) {
  if (typeof objectKey !== 'string' || !/^[\w./-]+$/.test(objectKey)) return null;
  if (objectKey.split('/').some((part) => part === '' || part === '.' || part === '..'))
    return null;
  return `${BIU_VIDEO_HOST}/video_bucket/${objectKey}.mp4`;
}

/**
 * A video of BIU's sidebar "וידיאו" block (a synthetic `biu-video` activity from the block's list).
 * Public object-store file: resolving and downloading never reach Moodle.
 */
export class BiuVideoExtractor extends VideoExtractor {
  get strategy() {
    return 'biu-video';
  }

  canHandle(activity) {
    return activity.modType === 'biu-video';
  }

  reachesMoodle() {
    return false;
  }

  // `videoId` and `objectKey` are the listing's only facts on the ref; date, length and thumbnail stay off it.
  toRecordings(activity) {
    return [
      {
        title: activity.title,
        kind: activity.kind,
        strategy: 'biu-video',
        section: activity.sectionName,
        courseId: activity.courseId,
        videoId: activity.videoId,
        objectKey: activity.objectKey,
        likelyRecording: true,
      },
    ];
  }
}
