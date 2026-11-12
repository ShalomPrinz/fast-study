# site/

The public download page at `https://shalomprinz.github.io/fast-study/`, for Hebrew-speaking students
on Windows. Plain HTML/CSS/JS with no build step and no dependency, deployed by
`.github/workflows/pages.yml`. Owned by `site-dev`.

| File          | What it is                                                                       |
| ------------- | -------------------------------------------------------------------------------- |
| `index.html`  | Every section, both languages' copy side by side as `.he` / `.en` spans          |
| `code-signing.html` | The code signing policy SignPath Foundation requires: its title and team roles on top, the full privacy policy as the last section (`#privacy`) — also the privacy URL Google OAuth brand verification holds, so it keeps the Drive scope, token and Limited Use lines |
| `style.css`   | The app's own tokens, light only, logical properties for both directions        |
| `main.js`     | The language toggle for every page: `?lang=`, then `localStorage`, then Hebrew; English title from `<title data-en>`. Also the demo player (below), the journey carousel, and the zoom overlay every `main img` but the demo poster opens (a `<dialog>`; Esc or a click anywhere but the arrows closes, focus returns). A journey shot's zoom also steps the four shots (edge arrows, ←/→ by reading direction, N of 4 counter, wrapping) by driving the carousel's `show()`, and the carousel and focus end on the last one viewed |
| `stamp.sh`    | Writes the latest release's version and size into a staged `index.html`         |
| `capture.mjs` | Recaptures the eleven app screenshots on a live app-harness stack, using the showcase dataset and helpers in `.claude/harness/showcase/` |
| `img/captured-version` | Release tag whose becoming latest triggered the last capture, taken from main at that time (`v1.2.3`); `pages.yml`'s `capture` job compares it with the latest release and never deploys it |
| `img/`        | The app screenshots (a 1280×800 layout at 2×, 2560×1600 JPEG, sharp at the carousel's 925px (85% of the 1088px slide) on high-DPI screens: `hero`, six `feature-*`, four `journey-*`), the logo (`icon.svg`, plus `logo-120.png` rendered from it for Google OAuth brand verification), the SmartScreen steps |
| `demo/`       | The demo video's source, never deployed: a Remotion project (`src/`), its footage (`public/footage/`), the music cut and `capture.mjs` |
| `video/`      | The rendered demo: `demo-he.mp4`, `demo-en.mp4` and a `poster-*.jpg` for each |
| `sitemap.xml` | Both page URLs, for Search Console; a new page gets a `<url>` here               |

`index.html`'s `<head>` carries the `google-site-verification` meta for the Search Console property
`https://shalomprinz.github.io/fast-study/` — removing or moving it out of `<head>` unverifies the
property. Each page's `<meta name="description">` is English only, since it is what a search result
shows; it names what sets the app apart from the other "FastStudy"s. No `robots.txt`: under a project
page it would sit at `/fast-study/robots.txt`, which crawlers never read.

Both pages load GoatCounter (site code `faststudy`, dashboard https://faststudy.goatcounter.com) for
visits, no cookies; both download buttons carry `data-goatcounter-click="download"`, one shared click count.

## What the page covers

Hero, the demo video (`#demo`), how it works, the lecture journey (`#journey`: a four-step carousel, one `journey-*` shot at a time, wrapping both ways; without JS the four steps stack), six features, universities, what you'll need, privacy (error reports included),
the SmartScreen install steps and a short FAQ. The footer links `code-signing.html`, which carries the
policy title and the roles SignPath's conditions require. Its role names (Committers and reviewers, Approvers) and the term "Code signing policy" — shown
in English in the Hebrew view too — follow [SignPath's conditions](https://signpath.org/terms.html) verbatim. Every claim is the app's current behaviour, checked
against the owning service's docs. `index.html`'s privacy section is the short version and links the
full policy, whose text mirrors the app's in-app policy plus one website-only GoatCounter line; its one contact channel is the repo's GitHub issues.

## The download link is frozen

`https://github.com/ShalomPrinz/fast-study/releases/latest/download/FastStudy-Setup.exe` — GitHub's
latest-release redirect onto the one name `electron/package.json`'s `artifactName` gives the
installer. Renaming the installer breaks every copy of this link.

## The version line

`<p class="version" hidden data-stamp>` holds `__VERSION__` / `__SIZE__` in both languages. At deploy
`pages.yml` copies `site/` to `_site/`, reads `gh api repos/…/releases/latest`, and `stamp.sh` fills
both from its `tag_name` and the `FastStudy-Setup.exe` asset's `size` (MB), sets `data-version` /
`data-size`, and drops `hidden`. No release, or no such asset, leaves the line hidden and the deploy
goes on. `publish.yml` dispatches `pages.yml` after each release, so the line follows every publish;
the page never calls the GitHub API itself.

```bash
cp -r site/. /tmp/stage && bash site/stamp.sh /tmp/stage release.json   # a releases/latest answer
python3 -m http.server -d /tmp/stage 8080
```

## Screenshots

`node site/capture.mjs --harness DIR` against a running stack (`node .claude/harness/setup.mjs
--harness DIR`) restores the harness baseline (`hb reseed`), wipes the scratch data root, writes the
showcase dataset (`.claude/harness/showcase/`) through the database routes, renders its PDFs and Drive links with the real steps
on the fakes, and rewrites `hero.jpg`, `feature-*.jpg` and `journey-*.jpg` in Hebrew; it is rerunnable.
Every name and text a shot shows comes from the showcase dataset, which is separate from the harness's test fixtures. The journey
follows `JOURNEY`: downloaded from the fake Moodle course's videostream row `הקלטה 4 — גרפים` on the `וידאו` tab, whose
probed size gives the download card a bar with time left, its run held on a slow fake Groq, then
given its dataset text. `feature-search` is shot after it, so the journey lecture is among the hits. `feature-ai` is the lecture view
of the overview course's first lecture, a finished one other than the hero's, with the Study with AI card in its side column.

`pages.yml`'s `capture` job runs this before every deploy: when the latest release's tag differs from
`img/captured-version` (no marker counts as different; no release skips), it sets up the harness
(`.github/actions/harness-setup`), captures, writes the marker and commits `site/img/` to main as
`github-actions[bot]` — one parent, rebased onto `origin/main` with retries, the shape `publish.yml`'s
walk-back over first-parent commits matches. `deploy` follows even when capture failed, checks out
main so it ships the new images, and drops the marker from `_site`. Heebo comes from the
`@fontsource/heebo` npm package (Hebrew subset included), so the runner needs no system Hebrew font.

The SmartScreen steps come from a real Windows install and cannot be captured here.

## Demo video

A 60-second walk through one lecture in Hebrew and English: a title card, four flows — downloading a
recording from the course's Moodle, the pipeline's steps completing, the summary PDF, the Drive
control on the finished lecture — and an end card with the page's own call to action. Each MP4 is
1920×1080 at 30 fps, H.264 yuv420p + AAC, moov atom first. Each poster is the composition's own
`Poster` still, not a frame of the video: the title card's logo, wordmark and tagline with the
wordmark above and the tagline below a centre left clear for the page's play button.

`demo/` is the one place in `site/` with a `package.json`: Remotion `4.0.543` (pinned), React and
`@fontsource/heebo`. The picture is stills of the app animated in code — camera, cursor, crossfades —
inside a drawn frame, never a screen recording. `src/strings/{he,en}.json` hold every word the video
draws and its direction, `src/timeline.mjs` every scene's and caption's frame; the composition takes
the language as a prop and picks that language's strings and footage.

```bash
node site/demo/capture.mjs --harness DIR   # rewrites demo/public/footage/ on a live app-harness stack
cd site/demo && npm ci && npm run render   # rewrites the four files in video/
cd site/demo && npm run posters            # rewrites the two posters alone, the MP4s untouched
```

`capture.mjs` seeds the showcase dataset and drives the journey lecture with two pages on one stack,
Hebrew acting and English watching, so both languages show the same state: the download's bar at five
points, each provider step held on its slow fake, the finished lecture, and the summary PDF's text
block as one sheet. Beside each language's stills, `manifest.json` records every still's place in the
1280×800 layout and the boxes the camera and cursor aim at, so the composition holds no coordinates.

The Downloads shots never frame anything under the card below the recording's: the rows further
down are the fake Moodle's own fixtures, so `Download` in `src/Scenes.jsx` ends every camera rect there.

On the page (`#demo`) nothing of the video loads before the click: `main.js` puts the page
language's poster, lazy, under a play button in a 16:9 frame, and the click swaps in a
`<video controls playsinline>` on `video/demo-<lang>.mp4`, playing with sound; its native controls
are the mute control. The language toggle swaps the poster, or a loaded video's file at the same
time and play state — both languages share one timeline. When it ends the poster returns. Without JS
the play button is a plain link to `video/demo-he.mp4` over the Hebrew poster.

Recapture and render are manual and their output is committed: rendering in CI would need Remotion
and a headless browser on the runner and would commit about 10 MB of binaries to main per release.
`pages.yml` deletes `demo/` from the staged copy.

Music: "Spring At Last" by HoliznaCC0, from "Spring at last (LOFI TAPE)", CC0 1.0 Universal —
https://freemusicarchive.org/music/holiznacc0/spring-at-last-lofi-tape/spring-at-last. `demo/public/music.mp3`
is the cut the video uses.
