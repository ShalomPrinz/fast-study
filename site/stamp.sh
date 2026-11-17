#!/usr/bin/env bash
# Stamps the latest release's version and each installer's size into a staged index.html and unhides the line.
# No release or no installer asset leaves it hidden; one missing asset hides only its size.
#   bash site/stamp.sh <staged site dir> [<GitHub releases/latest JSON>]
set -euo pipefail

page="$1/index.html"
release="${2:-}"

if [ -z "$release" ] || [ ! -s "$release" ]; then
  echo "stamp: no release — version line stays hidden"
  exit 0
fi

tag="$(jq -r '.tag_name // empty' "$release")"
asset_size() { jq -r --arg n "$1" '[.assets[]? | select(.name == $n) | .size][0] // empty' "$release"; }
win_bytes="$(asset_size FastStudy-Setup.exe)"
mac_bytes="$(asset_size FastStudy-mac-arm64.dmg)"
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
