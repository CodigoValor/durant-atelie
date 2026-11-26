# Gera os ícones do site (favicon) com a tesoura da marca Alinhavo (ouro sobre verde-musgo).
# Uso: python3 tools/gerar-favicon.py   (grava em ./ : favicon.ico, favicon-32.png, apple-touch-icon.png, icon-192.png, icon-512.png)
from PIL import Image, ImageDraw
FUNDO = (36, 48, 41, 255); OURO = (242, 172, 96, 255)
def tesoura(n, raio=.22, margem=.2):
    k = 4; N = n * k
    img = Image.new('RGBA', (N, N), (0, 0, 0, 0)); d = ImageDraw.Draw(img)
    d.rounded_rectangle((0, 0, N - 1, N - 1), radius=int(N * raio), fill=FUNDO)
    lado = N * (1 - 2 * margem); u = lado / 24; ox = oy = N * margem   # desenho em grade 24x24 (ícone "scissors")
    P = lambda x, y: (ox + x * u, oy + y * u); w = max(2, int(2 * u))
    for cx, cy in ((6, 6), (6, 18)):
        x, y = P(cx, cy); r = 3 * u
        d.ellipse((x - r, y - r, x + r, y + r), outline=OURO, width=w)
    for a, b in (((8.12, 8.12), (12, 12)), ((20, 4), (8.12, 15.88)), ((14.8, 14.8), (20, 20))):
        d.line([P(*a), P(*b)], fill=OURO, width=w)
        for q in (a, b):
            x, y = P(*q); d.ellipse((x - w / 2, y - w / 2, x + w / 2, y + w / 2), fill=OURO)
    return img.resize((n, n), Image.LANCZOS)
tesoura(32).save('favicon-32.png'); tesoura(180, raio=0).save('apple-touch-icon.png')
tesoura(192).save('icon-192.png'); tesoura(512).save('icon-512.png')
tesoura(48).save('favicon.ico', sizes=[(16, 16), (32, 32), (48, 48)])
print('ok')
