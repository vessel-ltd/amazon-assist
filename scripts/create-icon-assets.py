"""Export the generated icon to Chrome PNG sizes; preserve the original alpha."""
from pathlib import Path
from PIL import Image, ImageOps

root = Path(__file__).resolve().parent.parent
source = Image.open(root / 'docs/store/receipt-month-source.png').convert('RGBA')
art = source.crop(source.getchannel('A').getbbox())

for size, content_size in [(16, 14), (32, 28), (48, 42), (128, 96)]:
    resized = ImageOps.contain(art, (content_size, content_size), Image.Resampling.LANCZOS)
    canvas = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    canvas.alpha_composite(resized, ((size - resized.width) // 2, (size - resized.height) // 2))
    canvas.save(root / f'extension/icons/receipt-month{size}.png')
    if size == 128:
        canvas.save(root / 'docs/store/icon128.png')
    print(f'Exported {size}×{size}')
