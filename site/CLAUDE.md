# site/

The public download page at `https://shalomprinz.github.io/fast-study/`, for Hebrew-speaking students
on Windows. Plain HTML/CSS/JS with no build step and no dependency, deployed by
`.github/workflows/pages.yml`. Owned by `site-dev`.

| File          | What it is                                                                       |
| ------------- | -------------------------------------------------------------------------------- |
| `index.html`  | Every section, both languages' copy side by side as `.he` / `.en` spans          |
| `style.css`   | The app's own tokens, light only, logical properties for both directions        |
| `main.js`     | The language toggle: `?lang=`, then `localStorage`, then Hebrew                  |
| `stamp.sh`    | Writes the latest release's version and size into a staged `index.html`         |
| `capture.mjs` | Recaptures the seven app screenshots on a live app-harness stack                 |
| `img/`        | The screenshots (1280×800 JPEG), the logo, the SmartScreen steps                 |

## What the page covers

Hero, how it works, six features, universities, what you'll need, privacy (error reports included),
the SmartScreen install steps and a short FAQ. Every claim is the app's current behaviour, checked
against the owning service's docs; the page has no contact channel by design.

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
