#!/usr/bin/env python3
"""Generate Codex app icons (192 and 512)."""
from PIL import Image, ImageDraw, ImageFont

def make(size, path):
    img = Image.new("RGBA", (size, size), (26, 29, 33, 255))
    d = ImageDraw.Draw(img)

    # Bezel ring
    inset = int(size * 0.08)
    d.rounded_rectangle([inset, inset, size - inset, size - inset],
                        radius=int(size * 0.22),
                        outline=(58, 65, 75, 255), width=max(2, size // 96))

    # Pilot light (accent dot, top-left)
    pl = int(size * 0.10)
    cx = int(size * 0.25); cy = int(size * 0.25)
    d.ellipse([cx - pl, cy - pl, cx + pl, cy + pl],
              fill=(255, 106, 44, 255))

    # Big "C" in the center
    try:
        font = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", int(size * 0.55))
    except Exception:
        font = ImageFont.load_default()
    text = "C"
    bbox = d.textbbox((0, 0), text, font=font)
    tw = bbox[2] - bbox[0]; th = bbox[3] - bbox[1]
    tx = (size - tw) / 2 - bbox[0]
    ty = (size - th) / 2 - bbox[1] - int(size * 0.02)
    d.text((tx, ty), text, fill=(212, 215, 220, 255), font=font)

    # Tape-style tick marks along bottom
    by = int(size * 0.82)
    for i in range(11):
        x = int(size * 0.18 + i * (size * 0.064))
        h = int(size * 0.04) if i % 5 else int(size * 0.07)
        d.rectangle([x, by, x + 2, by + h], fill=(116, 228, 138, 255))

    img.save(path, "PNG")
    print(path, "->", img.size)

make(192, "/home/ubuntu/opencode/iphone-code-harness/icons/icon-192.png")
make(512, "/home/ubuntu/opencode/iphone-code-harness/icons/icon-512.png")
