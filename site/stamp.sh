#!/usr/bin/env bash
# Writes the latest release's version and installer size into a staged index.html and unhides the line.
# No release, or no FastStudy-Setup.exe asset, leaves the line hidden: the page still ships.
#   bash site/stamp.sh <staged site dir> [<GitHub releases/latest JSON>]
set -euo pipefail

page="$1/index.html"
release="${2:-}"

if [ -z "$release" ] || [ ! -s "$release" ]; then
  echo "stamp: no release — version line stays hidden"
  exit 0
fi

tag="$(jq -r '.tag_name // empty' "$release")"
bytes="$(jq -r '[.assets[]? | select(.name == "FastStudy-Setup.exe") | .size][0] // empty' "$release")"
if [ -z "$tag" ] || [ -z "$bytes" ]; then
  echo "stamp: release '${tag:-none}' has no FastStudy-Setup.exe — version line stays hidden"
  exit 0
fi

version="${tag#v}"
if ! [[ "$version" =~ ^[0-9A-Za-z.+-]+$ ]]; then
  echo "::error::stamp: tag '$tag' is not a version"
  exit 1
fi
mb=$(((bytes + 524288) / 1048576))

sed -i \
  -e "s/__VERSION__/$version/g" \
  -e "s/__SIZE__/$mb/g" \
  -e "s/ hidden data-stamp>/ data-version=\"$version\" data-size=\"$mb\">/" \
  "$page"

if ! grep -q "data-version=\"$version\"" "$page"; then
  echo "::error::stamp: no 'hidden data-stamp' version line in $page"
  exit 1
fi
echo "stamp: version $version, $mb MB"
