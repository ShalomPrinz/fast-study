// What `hb no-browser on` makes auto/'s launches do: a launch naming an installed channel (Chrome, Edge)
// fails as Playwright does when none is installed, while the bundled-Chromium fallback still works.
export function noBrowserError(options, flagged) {
  const channel = options?.channel;
  if (!flagged || !channel) return null;
  const dir = channel === 'msedge' ? 'microsoft' : 'google';
  return new Error(
    `Chromium distribution '${channel}' is not found at /opt/${dir}/${channel}/${channel}\n` +
      `Run "npx playwright install ${channel}"`,
  );
}
