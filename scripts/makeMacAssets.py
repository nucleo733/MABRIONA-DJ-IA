#!/usr/bin/env python3
"""
Assets de macOS para el instalador de MATOKO DJ.
============================================================
Genera, a partir de la imagen oficial `build/identidad/MATOKODJ.png`:

  - `build/icon.icns`  — icono real de la app (Finder, Dock, Applications, DMG).
  - `build/dmg-background.png` / `@2x` / `.tiff` — el fondo de la ventana del DMG.

La imagen oficial NUNCA se modifica: es la fuente, se lee y se copia,
nunca se sobrescribe. Todo lo demás es derivado y se puede volver a
generar con `python3 scripts/makeMacAssets.py`.
"""

import os
import shutil
import subprocess
from PIL import Image, ImageDraw, ImageFont

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OFICIAL = os.path.join(RAIZ, 'build', 'identidad', 'MATOKODJ.png')
BUILD = os.path.join(RAIZ, 'build')

# Ventana del DMG: cómoda en cualquier pantalla Mac, sin ser gigante.
ANCHO, ALTO = 760, 600

# Identidad MATOKO DJ — se toman del propio arte oficial, no son colores inventados.
FONDO_TOP = (14, 12, 24)
FONDO_BOT = (32, 18, 48)
TEXTO = (245, 243, 255)
TEXTO_TENUE = (160, 152, 190)

SFNS = '/System/Library/Fonts/SFNS.ttf'
ARIAL_BOLD = '/System/Library/Fonts/Supplemental/Arial Bold.ttf'
ARIAL = '/System/Library/Fonts/Supplemental/Arial.ttf'


def fuente(path, size):
    try:
        return ImageFont.truetype(path, size)
    except OSError:
        return ImageFont.load_default()


def hacer_icns():
    """PNG oficial → .icns con todos los tamaños que pide macOS."""
    origen = Image.open(OFICIAL).convert('RGBA')
    iconset = os.path.join(BUILD, 'icon.iconset')
    shutil.rmtree(iconset, ignore_errors=True)
    os.makedirs(iconset)

    for base in (16, 32, 128, 256, 512):
        for escala, sufijo in ((1, ''), (2, '@2x')):
            px = base * escala
            # LANCZOS: el redimensionado no deforma ni recorta — la imagen
            # oficial es cuadrada (1254x1254), así que la proporción se mantiene.
            origen.resize((px, px), Image.LANCZOS).save(
                os.path.join(iconset, f'icon_{base}x{base}{sufijo}.png'))

    icns = os.path.join(BUILD, 'icon.icns')
    subprocess.run(['iconutil', '-c', 'icns', iconset, '-o', icns], check=True)
    shutil.rmtree(iconset, ignore_errors=True)

    # El PNG que usan Linux y el resto del build sale de la misma fuente.
    origen.resize((512, 512), Image.LANCZOS).save(os.path.join(BUILD, 'icon.png'))
    return icns


def degradado(ancho, alto):
    fondo = Image.new('RGB', (ancho, alto))
    dib = ImageDraw.Draw(fondo)
    for y in range(alto):
        t = y / max(alto - 1, 1)
        dib.line([(0, y), (ancho, y)], fill=tuple(
            int(a + (b - a) * t) for a, b in zip(FONDO_TOP, FONDO_BOT)))
    return fondo


def hacer_fondo_dmg(escala):
    """Composición del DMG. `escala` 1 o 2 (retina) — mismo diseño, más píxeles."""
    a, al = ANCHO * escala, ALTO * escala
    img = degradado(a, al)
    dib = ImageDraw.Draw(img, 'RGBA')

    # Brillo suave detrás del arte, para que el personaje no quede plano
    # contra el fondo. Nada de adornos de más.
    cx, cy, r = 168 * escala, 160 * escala, 150 * escala
    for i in range(r, 0, -6 * escala):
        alfa = int(26 * (1 - i / r))
        dib.ellipse([cx - i, cy - i, cx + i, cy + i], fill=(120, 60, 200, alfa))

    # Arte oficial, cuadrado y sin recortar — solo escalado proporcional.
    # Va dentro de un marco fino para que el borde del arte se lea como
    # una pieza puesta a propósito y no como un recuadro pegado.
    arte = Image.open(OFICIAL).convert('RGBA')
    lado = 208 * escala
    arte = arte.resize((lado, lado), Image.LANCZOS)
    x0, y0 = cx - lado // 2, cy - lado // 2
    dib.rectangle([x0 - 3 * escala, y0 - 3 * escala, x0 + lado + 2 * escala, y0 + lado + 2 * escala],
                  outline=(126, 96, 200), width=2 * escala)
    img.paste(arte, (x0, y0), arte)

    f_titulo = fuente(ARIAL_BOLD, 44 * escala)
    f_sub = fuente(SFNS, 19 * escala)
    f_paso = fuente(SFNS, 17 * escala)
    f_pie = fuente(SFNS, 14 * escala)

    x = 330 * escala
    dib.text((x, 88 * escala), 'MATOKO DJ', font=f_titulo, fill=TEXTO)
    dib.text((x, 144 * escala), 'Mezcla profesional para Mac', font=f_sub, fill=TEXTO_TENUE)
    dib.line([(x, 188 * escala), (x + 250 * escala, 188 * escala)], fill=(120, 90, 190), width=2 * escala)
    dib.text((x, 208 * escala), 'Arrastra MATOKO DJ a Applications', font=f_paso, fill=TEXTO)

    # Flecha entre los dos iconos (que los pone el propio DMG, no esta imagen).
    y = 350 * escala
    x1, x2 = 300 * escala, 448 * escala
    dib.line([(x1, y), (x2, y)], fill=(150, 120, 220), width=3 * escala)
    dib.polygon([(x2 + 14 * escala, y), (x2 - 4 * escala, y - 10 * escala),
                 (x2 - 4 * escala, y + 10 * escala)], fill=(150, 120, 220))

    # Separador antes de la fila de extras (desinstalador y manual), para
    # que no se confundan con el paso de instalación de arriba.
    dib.line([(60 * escala, 428 * escala), (700 * escala, 428 * escala)], fill=(70, 56, 110), width=1 * escala)
    extras = 'Extras: desinstalador y manual'
    dib.text((60 * escala, 440 * escala), extras, font=f_pie, fill=TEXTO_TENUE)

    pie = 'Apple Silicon y Intel · macOS 11 o superior'
    ancho_pie = dib.textlength(pie, font=f_pie)
    dib.text(((a - ancho_pie) / 2, 566 * escala), pie, font=f_pie, fill=TEXTO_TENUE)

    destino = os.path.join(BUILD, f'dmg-background{"@2x" if escala == 2 else ""}.png')
    img.save(destino)
    return destino


def main():
    print('[assets] icono:', hacer_icns())
    uno = hacer_fondo_dmg(1)
    dos = hacer_fondo_dmg(2)
    # macOS toma la versión retina de un .tiff multi-resolución.
    tiff = os.path.join(BUILD, 'dmg-background.tiff')
    subprocess.run(['tiffutil', '-cathidpicheck', uno, dos, '-out', tiff], check=True)
    print('[assets] fondo del DMG:', tiff)


if __name__ == '__main__':
    main()
