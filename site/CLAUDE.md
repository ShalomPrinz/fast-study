# site/

The public download page at `https://shalomprinz.github.io/fast-study/`, for Hebrew-speaking students
on Windows. Plain HTML/CSS/JS with no build step and no dependency, deployed by
`.github/workflows/pages.yml`. Owned by `site-dev`.

| File          | What it is                                                                       |
| ------------- | -------------------------------------------------------------------------------- |
| `index.html`  | Every section, both languages' copy side by side as `.he` / `.en` spans          |
| `code-signing.html` | The code signing policy SignPath Foundation requires: its credit line and team roles on top, the full privacy policy as the last section (`#privacy`) |
| `style.css`   | The app's own tokens, light only, logical properties for both directions        |
| `main.js`     | The language toggle for every page: `?lang=`, then `localStorage`, then Hebrew; English title from `<title data-en>` |
| `stamp.sh`    | Writes the latest release's version and size into a staged `index.html`         |
| `capture.mjs` | Recaptures the seven app screenshots on a live app-harness stack                 |
| `img/`        | The screenshots (1280×800 JPEG), the logo, the SmartScreen steps                 |
| `sitemap.xml` | Both page URLs, for Search Console; a new page gets a `<url>` here               |

`index.html`'s `<head>` carries the `google-site-verification` meta for the Search Console property
`https://shalomprinz.github.io/fast-study/` — removing or moving it out of `<head>` unverifies the
property. Each page's `<meta name="description">` is English only, since it is what a search result
shows; it names what sets the app apart from the other "FastStudy"s. No `robots.txt`: under a project
page it would sit at `/fast-study/robots.txt`, which crawlers never read.

## What the page covers

Hero, how it works, six features, universities, what you'll need, privacy (error reports included),
the SmartScreen install steps and a short FAQ. The footer links `code-signing.html`, whose credit
sentence, role names (Committers and reviewers, Approvers) and the term "Code signing policy" — shown
in English in the Hebrew view too — follow [SignPath's conditions](https://signpath.org/terms.html) verbatim. Every claim is the app's current behaviour, checked
against the owning service's docs. `index.html`'s privacy section is the short version and links the
full policy, whose text mirrors the app's in-app policy; its one contact channel is the repo's GitHub issues.

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
--harness DIR`) reseeds it, renames the `hb-*` fixture courses to real-looking ones, runs the real
audio and PDF steps and the overview on the fakes, and rewrites the seven `img/*.jpg` in Hebrew. The
SmartScreen steps come from a real Windows install and cannot be captured here.
