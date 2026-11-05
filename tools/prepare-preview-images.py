#!/usr/bin/env python3
"""Label only the synthetic render outputs for the public repository README."""
import argparse
from pathlib import Path
from PIL import Image,ImageDraw,ImageFont
p=argparse.ArgumentParser();p.add_argument('source',type=Path);p.add_argument('destination',type=Path);args=p.parse_args()
args.destination.mkdir(parents=True,exist_ok=True)
for name,filename in [('login-mobile','login-390.png'),('admin-mobile','admin-390.png'),('faculty-desktop','faculty-1366.png')]:
 image=Image.open(args.source/filename).convert('RGB');image.thumbnail((1100,1100))
 result=Image.new('RGB',(image.width,image.height+32),'#151817');result.paste(image,(0,32))
 try:font=ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',11 if image.width<500 else 13)
 except OSError:font=ImageFont.load_default()
 ImageDraw.Draw(result).text((10,9),'SYNTHETIC PREVIEW | UNRELEASED SOURCE',font=font,fill='#e1be8c')
 result.save(args.destination/(name+'.webp'),'WEBP',quality=82,method=6)
