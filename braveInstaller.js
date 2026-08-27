'use strict'

/**
 * Instalación automática real de Brave en macOS — mismo criterio que
 * `installer/checkBrave.nsh` en Windows (revisa si Brave está
 * instalado, y si no, lo descarga e instala solo desde el paquete
 * oficial de Brave), adaptado a que el build de Mac es una `.app`
 * suelta (`dir`), no un instalador con permisos elevados como NSIS —
 * acá la instalación de Brave pide la contraseña real del usuario vía
 * el diálogo nativo de macOS (`osascript ... with administrator
 * privileges`), igual que cualquier instalador real de Mac.
 */

const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')
const { spawn } = require('node:child_process')

const MAC_APP_PATH = '/Applications/Brave Browser.app'
const MAC_PKG_URL = 'https://github.com/brave/brave-browser/releases/latest/download/Brave-Browser-universal.pkg'

function isBraveInstalledMac() {
  return fs.existsSync(MAC_APP_PATH)
}

function downloadPkg(destPath) {
  return new Promise((resolve, reject) => {
    const curl = spawn('curl', ['-L', '-f', '-o', destPath, MAC_PKG_URL], { stdio: 'ignore' })
    curl.on('exit', (code) => {
      if (code === 0 && fs.existsSync(destPath)) resolve()
      else reject(new Error(`No se pudo descargar el instalador de Brave (curl salió con código ${code})`))
    })
    curl.on('error', reject)
  })
}

function installPkgElevated(pkgPath) {
  return new Promise((resolve, reject) => {
    const safePath = pkgPath.replace(/(["\\$`])/g, '\\$1')
    const script = `do shell script "installer -pkg \\"${safePath}\\" -target /" with administrator privileges with prompt "MABRIONA DJ IA necesita instalar el navegador Brave"`
    const osa = spawn('osascript', ['-e', script], { stdio: 'ignore' })
    osa.on('exit', (code) => {
      if (code === 0) resolve()
      else reject(new Error(`La instalación de Brave no se completó (código ${code})`))
    })
    osa.on('error', reject)
  })
}

/** Descarga e instala Brave real en macOS, pidiendo la contraseña de admin al usuario. */
async function installBraveMac() {
  const pkgPath = path.join(os.tmpdir(), 'Brave-Browser-universal.pkg')
  await downloadPkg(pkgPath)
  try {
    await installPkgElevated(pkgPath)
  } finally {
    fs.unlink(pkgPath, () => {})
  }
}

module.exports = { isBraveInstalledMac, installBraveMac, MAC_APP_PATH }
