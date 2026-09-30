"""Create our original document icon and promotional artwork; no Amazon marks."""
from pathlib import Path
from PIL import Image, ImageDraw

root=Path(__file__).resolve().parent.parent
icons=root/'extension/icons'
store=root/'docs/store'
icons.mkdir(parents=True,exist_ok=True)
store.mkdir(parents=True,exist_ok=True)
icon=Image.new('RGBA',(512,512),(0,0,0,0))
d=ImageDraw.Draw(icon)
d.rounded_rectangle((64,64,448,448),radius=92,fill='#13787d',outline='#ffffff',width=5)
d.polygon([(160,130),(282,130),(352,200),(352,382),(160,382)],fill='white')
d.polygon([(282,130),(282,200),(352,200)],fill='#ffdc35')
for y,width in [(240,124),(278,92),(316,124)]:
    d.rounded_rectangle((194,y,194+width,y+12),radius=6,fill='#13787d')
for size in [16,32,48,128]:
    icon.resize((size,size),Image.Resampling.LANCZOS).save(icons/f'icon{size}.png')
promo=Image.new('RGB',(880,560),'#13787d')
pd=ImageDraw.Draw(promo)
for i in range(3):
    x=60+i*66;y=148-i*24
    pd.rounded_rectangle((x,y,x+170,y+242),radius=18,fill='#eef7f5')
    for line in range(4):
        pd.rounded_rectangle((x+28,y+54+line*36,x+136,y+64+line*36),radius=5,fill='#8cb8b6')
pd.polygon([(364,254),(424,254),(424,232),(472,280),(424,328),(424,306),(364,306)],fill='#ffdc35')
promo.paste(icon.resize((340,340),Image.Resampling.LANCZOS),(496,110),icon.resize((340,340),Image.Resampling.LANCZOS))
promo.resize((440,280),Image.Resampling.LANCZOS).save(store/'promo440.png')
