from PIL import Image, ImageDraw
import math

MAVI    = (42, 78, 148, 255)     # gorseldeki mavi biraz daha acik
TURUNCU = (244, 140, 32, 255)
BEYAZ   = (254, 254, 254, 255)
O = 10

def baklava(b):
    kenar = b / math.sqrt(2)
    x0 = (b - kenar) / 2
    x1 = x0 + kenar
    kare = Image.new('RGBA', (b, b), (0, 0, 0, 0))
    d = ImageDraw.Draw(kare)
    r = int(kenar * 0.13)
    d.rounded_rectangle([x0, x0, x1, x1], radius=r, fill=MAVI)
    bos = kenar * 0.075
    d.rounded_rectangle([x0 + bos, x0 + bos, x1 - bos, x1 - bos],
                        radius=int(r * 0.82), outline=TURUNCU,
                        width=max(int(kenar * 0.040), O))
    return kare.rotate(45, resample=Image.BICUBIC, expand=False)

def gecis_maskesi(b, kutu):
    """Govde icin turuncudan beyaza dikey gecis."""
    x0, y0, x1, y1 = kutu
    g = Image.new('RGBA', (b, b), (0, 0, 0, 0))
    p = g.load()
    h = max(int(y1 - y0), 1)
    for y in range(int(y0), int(y1) + 1):
        t = (y - y0) / h
        t = min(max((t - 0.05) / 0.75, 0), 1)     # ustte turuncu, ortada beyaza doner
        renk = tuple(int(TURUNCU[i] + (BEYAZ[i] - TURUNCU[i]) * t) for i in range(3)) + (255,)
        for x in range(int(x0), int(x1) + 1):
            p[x, y] = renk
    return g

def makine(b, gecisli, deklansor=True, vizor=True):
    k = Image.new('RGBA', (b, b), (0, 0, 0, 0))
    d = ImageDraw.Draw(k)

    gen = b * 0.385
    yuk = gen * 0.72
    mx, my = b / 2, b / 2 + b * 0.015
    gx0, gx1 = mx - gen / 2, mx + gen / 2
    gy0, gy1 = my - yuk / 2, my + yuk / 2

    # sekil maskesi: govde + sola kaymis vizor
    m = Image.new('L', (b, b), 0)
    dm = ImageDraw.Draw(m)
    if vizor:
        vg = gen * 0.30
        vx0 = gx0 + gen * 0.10
        dm.rounded_rectangle([vx0, gy0 - yuk * 0.30, vx0 + vg, gy0 + yuk * 0.20],
                             radius=int(b * 0.016), fill=255)
    dm.rounded_rectangle([gx0, gy0, gx1, gy1], radius=int(b * 0.045), fill=255)

    if gecisli:
        boya = gecis_maskesi(b, (gx0 - 2, gy0 - yuk * 0.32, gx1 + 2, gy1 + 2))
    else:
        boya = Image.new('RGBA', (b, b), BEYAZ)

    k = Image.composite(boya, k, m)
    d = ImageDraw.Draw(k)

    # objektif: mavi halka, ic kisim govde rengiyle ayni kalsin
    dis = gen * 0.225
    d.ellipse([mx - dis, my - dis, mx + dis, my + dis], fill=MAVI)
    ic = dis * 0.60
    icm = Image.new('L', (b, b), 0)
    ImageDraw.Draw(icm).ellipse([mx - ic, my - ic, mx + ic, my + ic], fill=255)
    k = Image.composite(boya, k, icm)
    d = ImageDraw.Draw(k)

    if deklansor:
        # govdeyi delen mavi nokta
        dr = gen * 0.055
        dx, dy = gx1 - gen * 0.14, gy0 + yuk * 0.24
        d.ellipse([dx - dr, dy - dr, dx + dr, dy + dr], fill=MAVI)

    return k

def ciz(B, gecisli, deklansor=True, vizor=True):
    b = B * O
    return Image.alpha_composite(baklava(b), makine(b, gecisli, deklansor, vizor)).resize((B, B), Image.LANCZOS)

SURUMLER = [
    ('gecisli-flasli', True, True, False),   # gecisli govde, flas var, vizor yok
]

for ad, gecisli, dek, viz in SURUMLER:
    boyutlar = [16, 24, 32, 48, 64, 128, 256]
    kareler = [ciz(x, gecisli, dek, viz) for x in boyutlar]
    kareler[-1].save(f'simge-{ad}.ico', format='ICO',
                     sizes=[(x, x) for x in boyutlar], append_images=kareler[:-1])
    ciz(256, gecisli, dek, viz).save(f'simge-{ad}-256.png')

sut = [256, 128, 64, 48, 32, 24, 16]
im = Image.new('RGBA', (sum(sut) + 24*6 + 60, 256 + 50), (240, 242, 244, 255))
x = 30
for bb in sut:
    s2 = ciz(bb, True, True, False)
    im.paste(s2, (x, 25 + (256 - bb)), s2)
    x += bb + 24
im.save('secilen-onizleme.png')

t = ciz(256, True, True, False)
print('kose alfalari:', [t.getpixel(p)[3] for p in [(2,2),(253,2),(2,253),(253,253)]])
print('uretildi')
