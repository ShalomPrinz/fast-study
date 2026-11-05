#!/usr/bin/env bash
# Cloud environment setup script: paste into the environment's "Setup script" at claude.ai/code. It
# runs as root before Claude Code starts and is snapshot-cached, so it provisions only the VM — see docs/CLOUD.md.
set -uo pipefail

# Keep in step with .github/actions/harness-setup/action.yml, which pins the shipped tectonic.
TECTONIC_VERSION=0.17.0

if ! command -v tectonic >/dev/null 2>&1; then
  curl -fsSL "https://github.com/tectonic-typesetting/tectonic/releases/download/tectonic%40${TECTONIC_VERSION}/tectonic-${TECTONIC_VERSION}-x86_64-unknown-linux-musl.tar.gz" \
    | tar -xz -C /usr/local/bin tectonic || echo "cloud setup: tectonic download failed" >&2
fi

# Fetches the LaTeX bundle index into the snapshot; needs the fullyjustified.net hosts allowlisted.
# A failure only leaves PDF rendering to fetch on first use, so it never fails the session start.
if command -v tectonic >/dev/null 2>&1; then
  warm="$(mktemp -d)"
  printf '\\documentclass{article}\\begin{document}warm\\end{document}\n' > "$warm/warm.tex"
  (cd "$warm" && timeout 240 tectonic warm.tex >/dev/null 2>&1) || echo "cloud setup: tectonic bundle fetch failed" >&2
  rm -rf "$warm"
fi

exit 0
