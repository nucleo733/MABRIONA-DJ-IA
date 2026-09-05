#!/bin/bash
# Instalador DMG de MATOKO DJ para macOS.
# ============================================================
# Arma "MATOKO DJ.dmg" a mano en vez de dejárselo al target `dmg` de
# electron-builder, por una razón concreta: ese target escribe el
# layout con la librería `ds_store` (un alias de disco antiguo) y el
# Finder de macOS actual NO llega a pintar la imagen de fondo — el DMG
# queda gris. Acá se hace del modo clásico y fiable: se monta el disco
# en modo lectura/escritura, se le da el aspecto con el propio Finder,
# y recién ahí se comprime a solo lectura.
#
# Además así se controla lo que el target `dmg` no expone: esconder la
# barra de herramientas y la de estado, y poner cuatro elementos
# (aplicación, Applications, desinstalador y manual) donde toca.
#
# Uso: bash scripts/makeDmg.sh
# Requiere que ya exista el build de la app (`dist/mac-universal/`).

set -euo pipefail

RAIZ="$(cd "$(dirname "$0")/.." && pwd)"
APP="$RAIZ/dist/mac-universal/MATOKO DJ.app"
DESINSTALADOR="$RAIZ/dist/Uninstall MATOKO DJ.app"
MANUAL="$RAIZ/dist/MATOKO DJ Manual.pdf"
FONDO="$RAIZ/build/dmg-background.tiff"
ICONO="$RAIZ/build/icon.icns"

VOLUMEN="MATOKO DJ"
# Carpeta OFICIAL de distribución del proyecto — congelada. `dist/` es
# solo el taller interno de electron-builder; lo que se publica vive acá.
RELEASE="$RAIZ/release/mac"
DESTINO="$RELEASE/MATOKO DJ.dmg"
STAGING="$RAIZ/dist/.dmg-staging"
TEMPORAL="$RAIZ/dist/.dmg-temporal.dmg"

# Medidas de la ventana. Tienen que coincidir con las de
# scripts/makeMacAssets.py, que es quien dibuja el fondo.
ANCHO=760
ALTO=600
ICONO_TAM=128

for requerido in "$APP" "$DESINSTALADOR" "$MANUAL" "$FONDO" "$ICONO"; do
  if [ ! -e "$requerido" ]; then
    echo "Falta: $requerido" >&2
    echo "Compilá primero con: npm run dist:mac" >&2
    exit 1
  fi
done

# Si quedó montado de una corrida anterior, se desmonta antes de nada.
if [ -d "/Volumes/$VOLUMEN" ]; then
  hdiutil detach "/Volumes/$VOLUMEN" -force -quiet || true
fi

echo "[dmg] preparando contenido…"
rm -rf "$STAGING" "$TEMPORAL"
mkdir -p "$STAGING/.background"
cp -R "$APP" "$STAGING/"
cp -R "$DESINSTALADOR" "$STAGING/"
cp "$MANUAL" "$STAGING/"
cp "$FONDO" "$STAGING/.background/fondo.tiff"
ln -s /Applications "$STAGING/Applications"

# Icono del propio disco montado, para que en el Finder y en el
# escritorio se vea MATOKO DJ y no el disco genérico.
cp "$ICONO" "$STAGING/.VolumeIcon.icns"
SetFile -a C "$STAGING" 2>/dev/null || true

echo "[dmg] creando imagen de disco…"
TAMANO=$(( $(du -sm "$STAGING" | cut -f1) + 120 ))
hdiutil create -srcfolder "$STAGING" -volname "$VOLUMEN" -fs HFS+ \
  -format UDRW -size "${TAMANO}m" "$TEMPORAL" -quiet

echo "[dmg] montando para darle el aspecto…"
DISPOSITIVO=$(hdiutil attach "$TEMPORAL" -readwrite -noverify -noautoopen | grep -E '^/dev/' | head -1 | awk '{print $1}')
sleep 2

# El aspecto (fondo, tamaño de icono, posiciones, ventana) lo escribe
# scripts/dmgLayout.py directo en el .DS_Store. No se le pide al Finder
# por AppleScript: el Finder guarda el aspecto de cada volumen por
# NOMBRE en su propio caché, y en una Mac donde ya se abrió un DMG
# anterior de MATOKO DJ pisa lo que se le acaba de pedir. Escribirlo a
# mano da el mismo resultado en cualquier Mac.
/usr/bin/python3 "$RAIZ/scripts/dmgLayout.py" "$VOLUMEN"

sync
sleep 2

echo "[dmg] comprimiendo…"
hdiutil detach "$DISPOSITIVO" -quiet || hdiutil detach "$DISPOSITIVO" -force -quiet
mkdir -p "$RELEASE"
rm -f "$DESTINO"
hdiutil convert "$TEMPORAL" -format UDZO -imagekey zlib-level=9 -o "$DESTINO" -quiet
rm -rf "$TEMPORAL" "$STAGING"

# Los cuatro artefactos oficiales, siempre en la misma carpeta.
echo "[dmg] copiando a la carpeta oficial release/mac…"
rm -rf "$RELEASE/MATOKO DJ.app" "$RELEASE/Uninstall MATOKO DJ.app"
cp -R "$APP" "$RELEASE/"
cp -R "$DESINSTALADOR" "$RELEASE/"
cp "$MANUAL" "$RELEASE/"

echo "[dmg] listo:"
ls -lh "$RELEASE"
