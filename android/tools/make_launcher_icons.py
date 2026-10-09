"""Writes the legacy (Android 7) launcher PNGs from the SENYA brand app icon.

Android 8+ uses the adaptive icon in res/mipmap-anydpi-v26 instead.
Run from anywhere: python android/tools/make_launcher_icons.py
"""
from pathlib import Path

from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[2]
SRC = ROOT / "SENYA-brand-final" / "senya-app-icon.png"
RES = ROOT / "android" / "app" / "src" / "main" / "res"
SIZES = {"mdpi": 48, "hdpi": 72, "xhdpi": 96, "xxhdpi": 144, "xxxhdpi": 192}


def masked(icon: Image.Image, draw_mask) -> Image.Image:
    mask = Image.new("L", icon.size, 0)
    draw_mask(ImageDraw.Draw(mask), (0, 0, icon.size[0] - 1, icon.size[1] - 1))
    out = Image.new("RGBA", icon.size, (0, 0, 0, 0))
    out.paste(icon, mask=mask)
    return out


def main() -> None:
    src = Image.open(SRC).convert("RGBA")
    for density, px in SIZES.items():
        icon = src.resize((px, px), Image.LANCZOS)
        folder = RES / f"mipmap-{density}"
        masked(icon, lambda d, box: d.rounded_rectangle(box, radius=px // 6, fill=255)).save(folder / "ic_launcher.png")
        masked(icon, lambda d, box: d.ellipse(box, fill=255)).save(folder / "ic_launcher_round.png")
        print(f"wrote {folder.name} ({px}px)")


if __name__ == "__main__":
    main()
