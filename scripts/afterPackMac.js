'use strict'

/**
 * Extras del instalador de macOS, generados en cada build.
 * ============================================================
 * Corre como `afterPack` de electron-builder: ya existe la `.app`
 * empaquetada, y todavía no se armó el `.dmg` — que es justo cuando
 * tienen que existir los dos archivos que van adentro del DMG junto a
 * la app:
 *
 *   - `Uninstall MATOKO DJ.app` (se compila desde
 *     `installer/uninstall.applescript` y se le pone el icono real).
 *   - `MATOKO DJ Manual.pdf` (lo dibuja `scripts/makeManual.py`).
 *
 * Los dos se dejan en `dist/`, que es de donde los toma
 * `build.dmg.contents` en package.json.
 */

const fs = require('node:fs')
const path = require('node:path')
const { execFileSync } = require('node:child_process')

const RAIZ = path.join(__dirname, '..')
const DIST = path.join(RAIZ, 'dist')

function compilarDesinstalador() {
  const destino = path.join(DIST, 'Uninstall MATOKO DJ.app')
  fs.rmSync(destino, { recursive: true, force: true })
  fs.mkdirSync(DIST, { recursive: true })

  execFileSync('osacompile', ['-o', destino, path.join(RAIZ, 'installer', 'uninstall.applescript')])

  // Icono real de MATOKO DJ, para que en el DMG no salga con el icono
  // genérico de AppleScript.
  const iconoApp = path.join(destino, 'Contents', 'Resources', 'applet.icns')
  fs.copyFileSync(path.join(RAIZ, 'build', 'icon.icns'), iconoApp)

  // Nombre y metadatos propios en vez de los de "applet".
  const plist = path.join(destino, 'Contents', 'Info.plist')
  const set = (clave, valor) => {
    try {
      execFileSync('/usr/libexec/PlistBuddy', ['-c', `Set :${clave} ${valor}`, plist])
    } catch {
      execFileSync('/usr/libexec/PlistBuddy', ['-c', `Add :${clave} string ${valor}`, plist])
    }
  }
  set('CFBundleName', 'Uninstall MATOKO DJ')
  // Sin esta clave, el applet de AppleScript sale con el icono genérico
  // blanco de Script Editor, aunque el .icns esté puesto en Resources.
  set('CFBundleIconFile', 'applet')
  set('CFBundleDisplayName', 'Uninstall MATOKO DJ')
  set('CFBundleIdentifier', 'com.matoko.dj.uninstaller')
  // El icono cambió: se toca la fecha del bundle para que Finder no
  // siga mostrando el icono viejo desde su caché.
  execFileSync('touch', [destino])

  console.log('[afterPack] desinstalador:', destino)
  return destino
}

/**
 * Python del sistema por ruta absoluta, no `python3` del PATH: en una
 * Mac con Homebrew el `python3` del PATH puede ser de otra
 * arquitectura que la del build y el proceso ni siquiera arranca
 * (error EBADARCH). El de `/usr/bin` es universal y viene con macOS.
 */
function python() {
  for (const bin of ['/usr/bin/python3', '/usr/local/bin/python3']) {
    if (fs.existsSync(bin)) return bin
  }
  return 'python3'
}

function generarManual() {
  execFileSync(python(), [path.join(RAIZ, 'scripts', 'makeManual.py')], { stdio: 'inherit' })
}

module.exports = async function afterPack(context) {
  if (context.electronPlatformName !== 'darwin') return
  compilarDesinstalador()
  generarManual()
}
