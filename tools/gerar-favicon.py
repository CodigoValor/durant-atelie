# Gera os ícones do site (favicon) a partir do emblema embutido no index.html.
# Uso: python3 tools/gerar-favicon.py   (grava em ./ : favicon.ico, favicon-32.png, apple-touch-icon.png, icon-192.png, icon-512.png)
import re,base64,io,sys
from PIL import Image,ImageDraw
s=open('index.html',encoding='utf8').read()
m=re.search(r'--emblem:url\("data:image/png;base64,([A-Za-z0-9+/=]+)',s) or re.search(r'data:image/png;base64,([A-Za-z0-9+/=]+)',s)
em=Image.open(io.BytesIO(base64.b64decode(m.group(1)))).convert('RGBA')
FUNDO=(36,48,41,255); OURO=(242,172,96)
alpha=em.split()[3]
ouro=Image.new('RGBA',em.size,OURO+(0,)); ouro.putalpha(alpha)
def icone(n,raio=.22,margem=.17):
    base=Image.new('RGBA',(n*4,n*4),(0,0,0,0)); d=ImageDraw.Draw(base)
    d.rounded_rectangle((0,0,n*4-1,n*4-1),radius=int(n*4*raio),fill=FUNDO)
    h=int(n*4*(1-2*margem)); w=int(h*ouro.width/ouro.height)
    e=ouro.resize((w,h),Image.LANCZOS)
    base.alpha_composite(e,((n*4-w)//2,(n*4-h)//2))
    return base.resize((n,n),Image.LANCZOS)
icone(32).save('favicon-32.png'); icone(180,raio=0,margem=.2).save('apple-touch-icon.png')
icone(192).save('icon-192.png'); icone(512).save('icon-512.png')
icone(48).save('favicon.ico',sizes=[(16,16),(32,32),(48,48)])
print('ok')
