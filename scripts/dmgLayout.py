#!/usr/bin/env python3
"""
Aspecto de la ventana del DMG de MATOKO DJ, escrito de forma determinista.
============================================================
Escribe el `.DS_Store` del disco montado: tamaño de ventana, fondo,
tamaño de icono y la posición de cada elemento.

Por qué no se le pide esto al Finder por AppleScript: el Finder guarda
en su propio caché el aspecto de cada volumen POR NOMBRE. Como el
volumen siempre se llama "MATOKO DJ", en una Mac donde ya se abrió un
DMG anterior el Finder pisa lo que se le acaba de pedir con lo que él
tenía guardado, y el fondo y el tamaño de icono se pierden — en una Mac
donde nunca se abrió, funciona. Escribir el `.DS_Store` a mano da el
mismo resultado siempre, en cualquier Mac.

Se apoya en las librerías `ds_store` y `mac_alias` que ya trae
electron-builder (`node_modules/dmg-builder/vendor`), que son las
mismas que usa `dmgbuild`.

Uso: /usr/bin/python3 scripts/dmgLayout.py "<nombre del volumen>"
"""

import os
import sys

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
VENDOR = os.path.join(RAIZ, 'node_modules', 'dmg-builder', 'vendor')
if not os.path.isdir(VENDOR):
    sys.exit(f'Falta {VENDOR} — instalá las dependencias con: npm install')
sys.path.insert(0, VENDOR)

import biplist                       # noqa: E402
from ds_store import DSStore         # noqa: E402
from mac_alias import Alias, Bookmark  # noqa: E402

# Mismas medidas que dibuja scripts/makeMacAssets.py. Si cambia una,
# cambian las dos.
ANCHO, ALTO = 760, 600
VENTANA_X, VENTANA_Y = 400, 100
ICONO = 128.0
TEXTO = 13.0

POSICIONES = {
    'MATOKO DJ.app': (210, 350),
    'Applications': (550, 350),
    'Uninstall MATOKO DJ.app': (210, 500),
    'MATOKO DJ Manual.pdf': (550, 500),
}


def main():
    volumen = sys.argv[1] if len(sys.argv) > 1 else 'MATOKO DJ'
    raiz_volumen = f'/Volumes/{volumen}'
    fondo = os.path.join(raiz_volumen, '.background', 'fondo.tiff')

    if not os.path.isdir(raiz_volumen):
        sys.exit(f'El disco {raiz_volumen} no está montado')
    if not os.path.isfile(fondo):
        sys.exit(f'Falta el fondo: {fondo}')

    bwsp = {
        'ShowStatusBar': False,
        'ShowTabView': False,
        'ShowToolbar': False,
        'ShowPathbar': False,
        'ShowSidebar': False,
        'ContainerShowSidebar': False,
        'SidebarWidth': 0,
        'WindowBounds': f'{{{{{VENTANA_X}, {VENTANA_Y}}}, {{{ANCHO}, {ALTO}}}}}',
    }

    icvp = {
        'viewOptionsVersion': 1,
        'backgroundType': 2,
        'backgroundImageAlias': biplist.Data(Alias.for_file(fondo).to_bytes()),
        'backgroundColorRed': 1.0,
        'backgroundColorGreen': 1.0,
        'backgroundColorBlue': 1.0,
        'gridOffsetX': 0.0,
        'gridOffsetY': 0.0,
        'gridSpacing': 100.0,
        'arrangeBy': 'none',
        'showIconPreview': True,
        'showItemInfo': False,
        'labelOnBottom': True,
        'textSize': TEXTO,
        'iconSize': ICONO,
        'scrollPositionX': 0.0,
        'scrollPositionY': 0.0,
    }

    destino = os.path.join(raiz_volumen, '.DS_Store')
    with DSStore.open(destino, 'w+') as d:
        d['.']['vSrn'] = ('long', 1)
        d['.']['bwsp'] = bwsp
        d['.']['icvp'] = icvp
        # `pBBk` es la forma nueva (bookmark) de apuntar al fondo; el
        # alias de `icvp` es la vieja. Se escriben las dos para que
        # funcione tanto en macOS actuales como en los anteriores.
        d['.']['pBBk'] = Bookmark.for_file(fondo)
        for nombre, (x, y) in POSICIONES.items():
            if os.path.exists(os.path.join(raiz_volumen, nombre)):
                d[nombre]['Iloc'] = (x, y)

    print(f'[layout] aspecto escrito en {destino}')


if __name__ == '__main__':
    main()
