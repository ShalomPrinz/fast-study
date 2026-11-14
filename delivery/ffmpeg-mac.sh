#!/bin/bash
# Build the macOS arm64 ffmpeg the release ships, with a static LAME — docs/RELEASE.md#the-macos-ffmpeg.
# usage: ffmpeg-mac.sh <work-dir>; the binary lands at <work-dir>/out/ffmpeg.
set -euxo pipefail

work=${1:?usage: ffmpeg-mac.sh <work-dir>}
: "${FFMPEG_VERSION:?}" "${FFMPEG_SHA256:?}" "${LAME_VERSION:?}" "${LAME_SHA256:?}"
# clang and ld both read it, so every object and the final link target the launcher's own minimum.
: "${MACOSX_DEPLOYMENT_TARGET:?}"

prefix=$work/prefix
mkdir -p "$work/src" "$work/out"
jobs=$(sysctl -n hw.ncpu)

fetch() {
  curl -fsSL --retry 5 --retry-delay 10 -o "$2" "$1"
  echo "$3  $2" | shasum -a 256 -c -
}
fetch "https://downloads.sourceforge.net/project/lame/lame/$LAME_VERSION/lame-$LAME_VERSION.tar.gz" "$work/src/lame.tar.gz" "$LAME_SHA256"
fetch "https://ffmpeg.org/releases/ffmpeg-$FFMPEG_VERSION.tar.xz" "$work/src/ffmpeg.tar.xz" "$FFMPEG_SHA256"
tar -xzf "$work/src/lame.tar.gz" -C "$work/src"
tar -xJf "$work/src/ffmpeg.tar.xz" -C "$work/src"

cd "$work/src/lame-$LAME_VERSION"
./configure --prefix="$prefix" --enable-static --disable-shared --disable-frontend --disable-dependency-tracking \
  || { tail -n 60 config.log; exit 1; }
make -j"$jobs"
make install

cd "$work/src/ffmpeg-$FFMPEG_VERSION"
./configure \
  --disable-autodetect \
  --enable-libmp3lame \
  --enable-securetransport \
  --enable-zlib \
  --extra-cflags="-I$prefix/include" \
  --extra-ldflags="-L$prefix/lib" \
  --disable-shared \
  --disable-ffprobe \
  --disable-ffplay \
  --disable-doc \
  --disable-debug \
  || { tail -n 60 ffbuild/config.log; exit 1; }
make -j"$jobs"
cp ffmpeg "$work/out/ffmpeg"
