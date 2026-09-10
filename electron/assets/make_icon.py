"""Draw electron/assets/icon.ico, the app icon electron-builder ships.

    python3 electron/assets/make_icon.py

Kept as a script rather than an SVG because nothing in the toolchain renders SVG, and the .ico is
the committed artifact either way. Colours are frontend/src/styles/tokens.css's --accent and
--surface, so the installer and the app read as one product.
"""

from pathlib import Path

from PIL import Image, ImageDraw

ACCENT = (79, 91, 213, 255)  # --accent
WHITE = (255, 255, 255, 255)  # --surface

# Two artworks, not one downsampled: the summary lines turn to grey mush below ~48px, so the small
# entries carry the play mark alone.
DETAILED = (256, 128, 64, 48)
SIMPLE = (32, 16)
SUPERSAMPLE = 8


def _play(draw: ImageDraw.ImageDraw, left: float, top: float, height: float) -> None:
    """A play triangle with rounded corners: the vertices pulled in toward the centroid by the
    radius, then the whole outline stroked back out at twice it — the standard rounding trick."""
    width = height * 0.86
    radius = height * 0.11
    corners = [(left, top), (left + width, top + height / 2), (left, top + height)]
    cx = sum(x for x, _ in corners) / 3
    cy = sum(y for _, y in corners) / 3
    points = []
    for x, y in corners:
        dx, dy = cx - x, cy - y
        scale = radius / (dx * dx + dy * dy) ** 0.5
        points.append((x + dx * scale, y + dy * scale))
    draw.polygon(points, fill=WHITE)
    # Every vertex has to fall *inside* the point list, not at either end: Pillow rounds interior
    # joints only, and a vertex left at an end keeps a butt cap that reads as a notch.
    draw.line([points[-1], *points, points[0]], fill=WHITE, width=int(radius * 2), joint="curve")


def _draw(size: int, detailed: bool) -> Image.Image:
    canvas = size * SUPERSAMPLE
    image = Image.new("RGBA", (canvas, canvas), (0, 0, 0, 0))
    draw = ImageDraw.Draw(image)
    draw.rounded_rectangle([0, 0, canvas - 1, canvas - 1], radius=canvas * 0.22, fill=ACCENT)

    if not detailed:
        _play(draw, canvas * 0.34, canvas * 0.27, canvas * 0.46)
        return image.resize((size, size), Image.LANCZOS)

    _play(draw, canvas * 0.17, canvas * 0.25, canvas * 0.34)
    # Three lines of decreasing width: the written summary the play mark turns into.
    line_height = canvas * 0.055
    for index, width in enumerate((0.52, 0.42, 0.30)):
        top = canvas * 0.60 + index * canvas * 0.115
        draw.rounded_rectangle(
            [canvas * 0.24, top, canvas * (0.24 + width), top + line_height],
            radius=line_height / 2,
            fill=WHITE,
        )
    return image.resize((size, size), Image.LANCZOS)


def main() -> None:
    images = [_draw(size, size in DETAILED) for size in (*DETAILED, *SIMPLE)]
    out = Path(__file__).with_name("icon.ico")
    # Pillow writes one entry per append_images member plus the base, each at its own resolution.
    images[0].save(out, format="ICO", sizes=[(i.width, i.height) for i in images], append_images=images[1:])
    print(f"wrote {out} — {', '.join(f'{i.width}px' for i in images)}")


if __name__ == "__main__":
    main()
