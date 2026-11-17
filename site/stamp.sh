#!/usr/bin/env bash
# Stamps the latest release's version and each installer's size into a staged index.html and unhides the line.
# No release or no installer asset leaves it hidden; one missing asset hides only its size.
# Without a release carrying FastStudy-mac-arm64.dmg the staged pages also lose every Mac block (see the gate).
#   bash site/stamp.sh <staged site dir> [<GitHub releases/latest JSON>]
set -euo pipefail

dir="$1"
page="$dir/index.html"
release="${2:-}"

asset_size() { jq -r --arg n "$1" '[.assets[]? | select(.name == $n) | .size][0] // empty' "$release" 2>/dev/null || true; }
mac_bytes=""
if [ -n "$release" ] && [ -s "$release" ]; then mac_bytes="$(asset_size FastStudy-mac-arm64.dmg)"; fi

# Mac-less release gate: temporary, removed per docs/MIGRATIONS.md. Drops <!--mac-only--> blocks, swaps in each <!--win-only:…:win-only--> and data-win-content copy, and frees the Windows elements from the OS toggle.
if [ -z "$mac_bytes" ]; then
  perl -0pi -e 's/<!--mac-only-->.*?<!--\/mac-only-->//gs; s/<!--win-only:(.*?):win-only-->/$1/gs; s/ content="[^"]*"(\s+)data-win-content="([^"]*)"/ content="$2"/g; s/ for-win\b//g' "$page" "$dir/code-signing.html"
  echo "stamp: no FastStudy-mac-arm64.dmg — pages are Windows only"
else
  perl -0pi -e 's/<!--\/?mac-only-->//g; s/<!--win-only:.*?:win-only-->//gs; s/\s+data-win-content="[^"]*"//g' "$page" "$dir/code-signing.html"
fi

if [ -z "$release" ] || [ ! -s "$release" ]; then
  echo "stamp: no release — version line stays hidden"
  exit 0
fi

tag="$(jq -r '.tag_name // empty' "$release" 2>/dev/null || true)"
win_bytes="$(asset_size FastStudy-Setup.exe)"
if [ -z "$tag" ] || { [ -z "$win_bytes" ] && [ -z "$mac_bytes" ]; }; then
  echo "stamp: release '${tag:-none}' has no installer asset — version line stays hidden"
  exit 0
fi

version="${tag#v}"
if ! [[ "$version" =~ ^[0-9A-Za-z.+-]+$ ]]; then
  echo "::error::stamp: tag '$tag' is not a version"
  exit 1
fi
mb() { echo $((($1 + 524288) / 1048576)); }
flags=""
win_mb=""
mac_mb=""
if [ -n "$win_bytes" ]; then win_mb="$(mb "$win_bytes")"; flags="$flags data-size=\"$win_mb\""; else flags="$flags data-nowin"; fi
if [ -n "$mac_bytes" ]; then mac_mb="$(mb "$mac_bytes")"; flags="$flags data-size-mac=\"$mac_mb\""; else flags="$flags data-nomac"; fi

sed -i \
  -e "s/__VERSION__/$version/g" \
  -e "s/__SIZE_MAC__/$mac_mb/g" \
  -e "s/__SIZE__/$win_mb/g" \
  -e "s/ hidden data-stamp>/ data-version=\"$version\"$flags>/" \
  "$page"

if ! grep -q "data-version=\"$version\"" "$page"; then
  echo "::error::stamp: no 'hidden data-stamp' version line in $page"
  exit 1
fi
echo "stamp: version $version${win_bytes:+, windows $win_mb MB}${mac_bytes:+, mac $mac_mb MB}"
