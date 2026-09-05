#!/usr/bin/env python3
"""
Manual de MATOKO DJ para macOS → `MATOKO DJ Manual.pdf`.
============================================================
El contenido describe SOLO lo que la app hace de verdad hoy (instalar,
abrir, mover a Applications, desinstalar, requisitos, Apple Silicon).
No se inventan funciones: si algo no está implementado, no se menciona.

Se dibuja con Pillow y se guarda como PDF real de varias páginas — sin
depender de LaTeX, Word ni ninguna herramienta que no venga con macOS.
"""

import os
from PIL import Image, ImageDraw, ImageFont

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OFICIAL = os.path.join(RAIZ, 'build', 'identidad', 'MATOKODJ.png')

# A4 a 150 ppp — tamaño de página estándar, legible en pantalla e imprimible.
ANCHO, ALTO = 1240, 1754
MARGEN = 110
NEGRO = (24, 22, 34)
GRIS = (92, 88, 108)
MORADO = (96, 60, 176)
LINEA = (208, 202, 224)

SFNS = '/System/Library/Fonts/SFNS.ttf'
ARIAL_BOLD = '/System/Library/Fonts/Supplemental/Arial Bold.ttf'


def f(path, size):
    try:
        return ImageFont.truetype(path, size)
    except OSError:
        return ImageFont.load_default()


F_TITULO = f(ARIAL_BOLD, 58)
F_H2 = f(ARIAL_BOLD, 32)
F_TXT = f(SFNS, 24)
F_PIE = f(SFNS, 18)

CONTENIDO = [
    ('1. Requisitos', [
        'macOS 11 (Big Sur) o superior.',
        'Mac con chip Apple Silicon (M1, M2, M3, M4) o con procesador Intel.',
        'Conexión a internet para buscar música en YouTube.',
        'Unos 700 MB libres en el disco.',
    ]),
    ('2. Compatibilidad con Apple Silicon', [
        'MATOKO DJ se distribuye como aplicación Universal 2: el mismo archivo',
        'lleva la versión para Apple Silicon (arm64) y la versión para Intel',
        '(x86_64). Tu Mac usa automáticamente la que le corresponde, sin',
        'Rosetta y sin que tengas que elegir nada.',
    ]),
    ('3. Cómo instalar MATOKO DJ', [
        'Paso 1. Haz doble clic en el archivo "MATOKO DJ.dmg". Se abre una',
        'ventana con el icono de MATOKO DJ y una carpeta llamada Applications.',
        '',
        'Paso 2. Arrastra el icono de MATOKO DJ encima de la carpeta',
        'Applications. Espera a que termine de copiarse.',
        '',
        'Paso 3. Cierra la ventana y expulsa el disco "MATOKO DJ" que aparece',
        'en el Finder (arrástralo a la papelera o pulsa el botón de expulsar).',
        '',
        'Paso 4. Ya puedes borrar el archivo .dmg si quieres. La aplicación',
        'queda instalada en la carpeta Aplicaciones.',
    ]),
    ('4. Cómo abrir MATOKO DJ', [
        'Abre el Finder, entra en Aplicaciones y haz doble clic en MATOKO DJ.',
        '',
        'La primera vez, si macOS avisa de que la aplicación es de un',
        'desarrollador no identificado: haz clic derecho sobre MATOKO DJ,',
        'elige Abrir y confirma con el botón Abrir. Solo hace falta la',
        'primera vez.',
        '',
        'Si tu Mac no tiene el navegador Brave instalado, MATOKO DJ lo instala',
        'antes de abrirse y te pide tu contraseña de administrador. Brave viene',
        'incluido dentro del propio instalador, así que no hace falta',
        'descargarlo aparte. Si ya lo tienes, no se instala nada.',
    ]),
    ('5. Cómo desinstalar MATOKO DJ', [
        'Dentro del mismo archivo .dmg hay una aplicación llamada',
        '"Uninstall MATOKO DJ". Ábrela y confirma.',
        '',
        'Te muestra antes la lista exacta de lo que va a borrar: la aplicación',
        'y los archivos que la propia aplicación creó (su configuración, su',
        'caché y sus datos). No toca tu música, tus documentos, tus descargas',
        'ni ninguna otra aplicación.',
        '',
        'Brave no se desinstala: es un navegador aparte y se queda instalado.',
        'Si quieres quitarlo, hazlo por separado desde Aplicaciones.',
    ]),
    ('6. Qué es MATOKO DJ', [
        'MATOKO DJ es una aplicación de mezcla para Mac. Busca música en',
        'YouTube desde su propia caja de búsqueda —usa Brave Search, sin abrir',
        'ningún navegador— y la carga en sus platos para mezclar.',
        '',
        'Incluye perfiles de DJ, biblioteca de música propia y separación de',
        'pistas (voces e instrumentos) en la misma computadora.',
    ]),
]


def pagina():
    img = Image.new('RGB', (ANCHO, ALTO), (255, 255, 255))
    return img, ImageDraw.Draw(img)


def pie(dib, numero):
    dib.line([(MARGEN, ALTO - 92), (ANCHO - MARGEN, ALTO - 92)], fill=LINEA, width=1)
    dib.text((MARGEN, ALTO - 76), 'MATOKO DJ — Manual para macOS', font=F_PIE, fill=GRIS)
    txt = f'Página {numero}'
    dib.text((ANCHO - MARGEN - dib.textlength(txt, font=F_PIE), ALTO - 76), txt, font=F_PIE, fill=GRIS)


def main():
    paginas = []

    # Portada
    img, dib = pagina()
    arte = Image.open(OFICIAL).convert('RGB').resize((420, 420), Image.LANCZOS)
    img.paste(arte, ((ANCHO - 420) // 2, 300))
    t = 'MATOKO DJ'
    dib.text(((ANCHO - dib.textlength(t, font=F_TITULO)) / 2, 800), t, font=F_TITULO, fill=NEGRO)
    s = 'Manual de instalación para macOS'
    dib.text(((ANCHO - dib.textlength(s, font=F_TXT)) / 2, 880), s, font=F_TXT, fill=GRIS)
    dib.line([(ANCHO / 2 - 120, 940), (ANCHO / 2 + 120, 940)], fill=MORADO, width=3)
    v = 'Instalar · Abrir · Desinstalar'
    dib.text(((ANCHO - dib.textlength(v, font=F_TXT)) / 2, 980), v, font=F_TXT, fill=NEGRO)
    paginas.append(img)

    # Contenido
    img, dib = pagina()
    y = MARGEN
    numero = 2
    for titulo, lineas in CONTENIDO:
        alto_bloque = 70 + len(lineas) * 38 + 40
        if y + alto_bloque > ALTO - 130:
            pie(dib, numero)
            paginas.append(img)
            numero += 1
            img, dib = pagina()
            y = MARGEN
        dib.text((MARGEN, y), titulo, font=F_H2, fill=NEGRO)
        y += 18
        dib.line([(MARGEN, y + 30), (MARGEN + 90, y + 30)], fill=MORADO, width=3)
        y += 56
        for linea in lineas:
            dib.text((MARGEN, y), linea, font=F_TXT, fill=NEGRO if linea else GRIS)
            y += 38
        y += 40
    pie(dib, numero)
    paginas.append(img)

    destino = os.path.join(RAIZ, 'dist', 'MATOKO DJ Manual.pdf')
    os.makedirs(os.path.dirname(destino), exist_ok=True)
    paginas[0].save(destino, 'PDF', resolution=150.0, save_all=True, append_images=paginas[1:])
    print('[manual]', destino, f'({len(paginas)} páginas)')


if __name__ == '__main__':
    main()
