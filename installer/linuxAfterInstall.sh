#!/bin/sh
# Integración real MATOKO DJ + Brave — instalador Linux (.deb / .rpm)
# ============================================================
# Mismo criterio que `installer/checkBrave.nsh` (Windows) y
# `braveInstaller.js` (Mac): MATOKO DJ usa Brave para buscar/elegir
# música de YouTube, así que el instalador comprueba si Brave ya está
# instalado y, si no, lo instala solo.
#
# El paquete oficial real de Brave viene EMBEBIDO dentro de este mismo
# instalador (lo baja `scripts/fetchBrave.js` al compilar y queda en
# `resources/brave/`), así que instalar Brave funciona aunque la
# computadora no tenga internet. Si ese archivo no estuviera — un build
# hecho sin él — se cae al script oficial real de Brave Software
# (dl.brave.com/install.sh, fuente github.com/brave/install.sh — nunca
# un mirror de terceros), que sí necesita internet.
#
# electron-builder lo engancha como `afterInstall` real: en .deb corre
# dentro del `postinst` y en .rpm dentro del `%post`, siempre como
# root, así que la instalación de Brave NO le pide ninguna contraseña
# extra al usuario.
#
# Detalle importante del gestor de paquetes: este script se ejecuta
# mientras dpkg/rpm todavía tienen tomado su propio lock instalando
# MATOKO DJ, y el script de Brave usa apt-get/dnf — si se llamara
# directo acá, se trabaría contra sí mismo. Por eso la instalación de
# Brave se lanza desacoplada (`setsid`, en segundo plano) esperando a
# que el gestor de paquetes se libere, y el instalador de MATOKO DJ
# termina sin bloquearse.

set -e

BRAVE_INSTALL_URL="https://dl.brave.com/install.sh"

# ¿Ya está instalado? Mismos nombres/rutas reales con los que Brave
# queda en Linux según cómo se haya instalado (paquete, tarball o
# Flatpak).
brave_installed() {
  for cmd in brave-browser brave-browser-stable brave; do
    command -v "$cmd" >/dev/null 2>&1 && return 0
  done
  [ -x /opt/brave.com/brave/brave ] && return 0
  [ -x /usr/bin/brave-browser ] && return 0
  flatpak info com.brave.Browser >/dev/null 2>&1 && return 0
  return 1
}

if brave_installed; then
  echo "MATOKO DJ: Brave ya está instalado — no se reinstala."
  exit 0
fi

# Paquete embebido: se busca al lado de esta misma copia instalada de
# MATOKO DJ (`resources/brave/`), sin depender de una ruta fija de
# instalación.
APP_DIR="$(dirname "$(readlink -f "$0" 2>/dev/null || echo "$0")")"
BRAVE_DEB=""
BRAVE_RPM=""
for base in "$APP_DIR/resources/brave" "$APP_DIR/../resources/brave" /opt/*/resources/brave; do
  [ -f "$base/brave-browser.deb" ] && [ -z "$BRAVE_DEB" ] && BRAVE_DEB="$base/brave-browser.deb"
  [ -f "$base/brave-browser.rpm" ] && [ -z "$BRAVE_RPM" ] && BRAVE_RPM="$base/brave-browser.rpm"
done

if command -v dpkg >/dev/null 2>&1 && [ -n "$BRAVE_DEB" ]; then
  INSTALL_CMD="apt-get install -y \"$BRAVE_DEB\""
elif command -v rpm >/dev/null 2>&1 && [ -n "$BRAVE_RPM" ]; then
  INSTALL_CMD="rpm -U --replacepkgs \"$BRAVE_RPM\""
elif command -v curl >/dev/null 2>&1; then
  INSTALL_CMD="curl -fsS $BRAVE_INSTALL_URL | sh"
else
  echo "MATOKO DJ: no hay paquete de Brave embebido ni curl para bajarlo." >&2
  echo "MATOKO DJ: instalalo a mano desde https://brave.com/download/" >&2
  exit 0
fi

echo "MATOKO DJ: falta Brave (necesario para buscar música en YouTube) — se instala al terminar."

# Espera a que el gestor de paquetes libere su lock (máx. 5 min) y
# recién ahí instala Brave. Todo desacoplado para no colgar el postinst
# — dpkg/rpm siguen tomados instalando MATOKO DJ mientras esto corre.
setsid sh -c '
  i=0
  while [ "$i" -lt 60 ]; do
    if command -v fuser >/dev/null 2>&1; then
      fuser /var/lib/dpkg/lock-frontend /var/lib/rpm/.rpm.lock >/dev/null 2>&1 || break
    else
      break
    fi
    i=$((i + 1))
    sleep 5
  done
  '"$INSTALL_CMD"'
' >/dev/null 2>&1 < /dev/null &

exit 0
