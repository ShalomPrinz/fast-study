/**
 * A discovered video and the material needed to replay its request later.
 * This shape is deliberately exactly what server.js's POST /download consumes.
 * @typedef {{ title: string, url: string, headers: Record<string, string> }} VideoCapture
 */

export class CourseSource {
  /**
   * @param {import('../auth/AuthProvider.js').StorageState} authState  from AuthProvider.getAuthState()
   * @param {string} courseUrl
   * @returns {Promise<VideoCapture[]>}  discovered videos (deduped)
   */
  async listVideos(authState, courseUrl) {
    throw new Error('not implemented');
  }
}
