# site/

The public download page at `https://shalomprinz.github.io/fast-study/`, for Hebrew-speaking students
on Windows. Plain HTML/CSS/JS with no build step and no dependency, deployed by
`.github/workflows/pages.yml`. Owned by `site-dev`.

| File          | What it is                                                                       |
| ------------- | -------------------------------------------------------------------------------- |
| `index.html`  | Every section, both languages' copy side by side as `.he` / `.en` spans          |
| `code-signing.html` | The code signing policy SignPath Foundation requires: its title and team roles on top, the full privacy policy as the last section (`#privacy`) — also the privacy URL Google OAuth brand verification holds, so it keeps the Drive scope, token and Limited Use lines |
| `style.css`   | The app's own tokens, light only, logical properties for both directions        |
| `main.js`     | The language toggle for every page: `?lang=`, then `localStorage`, then Hebrew; English title from `<title data-en>`. Also the journey carousel |
| `stamp.sh`    | Writes the latest release's version and size into a staged `index.html`         |
| `capture.mjs` | Recaptures the eleven app screenshots on a live app-harness stack from `capture/` |
| `capture/`    | The screenshots' own dataset: `dataset.mjs` (courses, lectures, the journey's lecture) and `text/` (Hebrew transcripts and summaries) |
| `img/`        | The app screenshots (a 1280×800 layout at 2×, 2560×1600 JPEG, sharp at the carousel's 1088px on high-DPI screens: `hero`, six `feature-*`, four `journey-*`), the logo (`icon.svg`, plus `logo-120.png` rendered from it for Google OAuth brand verification), the SmartScreen steps |
| `sitemap.xml` | Both page URLs, for Search Console; a new page gets a `<url>` here               |

`index.html`'s `<head>` carries the `google-site-verification` meta for the Search Console property
`https://shalomprinz.github.io/fast-study/` — removing or moving it out of `<head>` unverifies the
property. Each page's `<meta name="description">` is English only, since it is what a search result
shows; it names what sets the app apart from the other "FastStudy"s. No `robots.txt`: under a project
page it would sit at `/fast-study/robots.txt`, which crawlers never read.

Both pages load GoatCounter (site code `faststudy`, dashboard https://faststudy.goatcounter.com) for
visits, no cookies; both download buttons carry `data-goatcounter-click="download"`, one shared click count.

## What the page covers

Hero, how it works, the lecture journey (`#journey`: a four-step carousel, one `journey-*` shot at a time, wrapping both ways; without JS the four steps stack), six features, universities, what you'll need, privacy (error reports included),
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
`capture/` dataset through the database routes, renders its PDFs and Drive links with the real steps
on the fakes, and rewrites `hero.jpg`, `feature-*.jpg` and `journey-*.jpg` in Hebrew; it is rerunnable.
Every name and text a shot shows comes from `capture/`, never the harness fixtures. The journey
follows `JOURNEY`: downloaded from the fake Moodle course's plain-link row `הקלטה 3 — עצים`, whose
probed size gives the download card a bar with time left, its run held on a slow fake Groq, then
given its dataset text. `feature-search` is shot after it, so the journey lecture is among the hits.
The SmartScreen steps come from a real Windows install and cannot be captured here.
