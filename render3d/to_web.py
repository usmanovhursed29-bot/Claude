"""Готовит рендеры для сайта: webp 1440px + пометка «Визуализация» в углу."""
import sys, os
from PIL import Image, ImageDraw, ImageFont
src, dst = sys.argv[1], sys.argv[2]
os.makedirs(dst, exist_ok=True)
font = None
for f in ["/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf", "/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf"]:
    if os.path.exists(f): font = ImageFont.truetype(f, 22); break
for name in sorted(os.listdir(src)):
    if not name.endswith(".jpg"): continue
    im = Image.open(os.path.join(src, name)).convert("RGB")
    d = ImageDraw.Draw(im, "RGBA"); text = "Визуализация · kwantoww"
    tw = d.textlength(text, font=font); w, h = im.size
    d.rounded_rectangle((w - tw - 44, h - 58, w - 16, h - 16), 14, fill=(255, 255, 255, 200))
    d.text((w - tw - 30, h - 50), text, fill=(40, 36, 32, 255), font=font)
    out = os.path.join(dst, name.replace(".jpg", ".webp"))
    im.save(out, "WEBP", quality=80, method=6)
    print(out, os.path.getsize(out) // 1024, "KB")
