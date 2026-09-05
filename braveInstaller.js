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

/**
 * Instalador de Brave EMBEBIDO en el propio build (lo baja
 * `scripts/fetchBrave.js` al compilar y queda en `resources/brave/`).
 * Es lo que hace que instalar Brave funcione sin internet. Si por lo
 * que sea no está — un build viejo, o corriendo desde el código sin
 * haber compilado — se cae a bajarlo en el momento, que es como
 * funcionaba antes.
 */
function embeddedInstaller(fileName) {
  const base = process.resourcesPath || path.join(__dirname, 'resources')
  const embedded = path.join(base, 'brave', fileName)
  return fs.existsSync(embedded) ? embedded : null
}

const MAC_APP_PATH = '/Applications/Brave Browser.app'
const MAC_PKG_URL = 'https://github.com/brave/brave-browser/releases/latest/download/Brave-Browser-universal.pkg'

/**
 * Linux — mismas rutas/nombres reales con los que queda Brave según
 * cómo se haya instalado (paquete del repo oficial, tarball suelto o
 * Flatpak), y el script de instalación oficial real de Brave Software
 * (fuente: github.com/brave/install.sh), que detecta solo la distro y
 * usa su gestor de paquetes.
 */
const LINUX_BINARIES = [
  '/usr/bin/brave-browser',
  '/usr/bin/brave-browser-stable',
  '/usr/bin/brave',
  '/opt/brave.com/brave/brave',
  '/snap/bin/brave',
  '/var/lib/flatpak/exports/bin/com.brave.Browser',
]
const LINUX_INSTALL_URL = 'https://dl.brave.com/install.sh'

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
    const script = `do shell script "installer -pkg \\"${safePath}\\" -target /" with administrator privileges with prompt "DJ AI App necesita instalar el navegador Brave"`
    const osa = spawn('osascript', ['-e', script], { stdio: 'ignore' })
    osa.on('exit', (code) => {
      if (code === 0) resolve()
      else reject(new Error(`La instalación de Brave no se completó (código ${code})`))
    })
    osa.on('error', reject)
  })
}

function isBraveInstalledLinux() {
  return LINUX_BINARIES.some((bin) => fs.existsSync(bin))
}

/**
 * Instala Brave real en Linux. El instalador `.deb`/`.rpm` de MATOKO DJ
 * ya lo hace por su cuenta como root (ver
 * `installer/linuxAfterInstall.sh`), pero eso no cubre la AppImage —
 * que no tiene instalador ninguno — ni el caso de que el usuario
 * desinstale Brave después. Acá se usa `pkexec` (PolicyKit), que es el
 * diálogo gráfico de contraseña estándar de Linux — el equivalente
 * real del `with administrator privileges` de macOS.
 */
function installBraveLinux() {
  // Paquete embebido primero: se instala con el gestor de paquetes de
  // la distro, sin tocar internet.
  const embeddedDeb = embeddedInstaller('brave-browser.deb')
  const embeddedRpm = embeddedInstaller('brave-browser.rpm')
  const usaDeb = fs.existsSync('/usr/bin/dpkg') || fs.existsSync('/usr/bin/apt-get')
  const paquete = usaDeb ? embeddedDeb : embeddedRpm
  if (paquete) {
    return new Promise((resolve, reject) => {
      const cmd = usaDeb
        ? ['apt-get', 'install', '-y', paquete]
        : ['rpm', '-U', '--replacepkgs', paquete]
      const elevated = spawn('pkexec', cmd, { stdio: 'ignore' })
      elevated.on('error', reject)
      elevated.on('exit', (code) => {
        if (code === 0) resolve()
        else reject(new Error(`La instalación de Brave no se completó (código ${code})`))
      })
    })
  }

  return new Promise((resolve, reject) => {
    const scriptPath = path.join(os.tmpdir(), 'brave-install.sh')
    const curl = spawn('curl', ['-fsS', '-o', scriptPath, LINUX_INSTALL_URL], { stdio: 'ignore' })
    curl.on('error', reject)
    curl.on('exit', (code) => {
      if (code !== 0 || !fs.existsSync(scriptPath)) {
        reject(new Error(`No se pudo descargar el instalador de Brave (curl salió con código ${code})`))
        return
      }
      const elevated = spawn('pkexec', ['sh', scriptPath], { stdio: 'ignore' })
      elevated.on('error', (err) => {
        fs.unlink(scriptPath, () => {})
        reject(err)
      })
      elevated.on('exit', (exitCode) => {
        fs.unlink(scriptPath, () => {})
        if (exitCode === 0) resolve()
        else reject(new Error(`La instalación de Brave no se completó (código ${exitCode})`))
      })
    })
  })
}

/** Descarga e instala Brave real en macOS, pidiendo la contraseña de admin al usuario. */
async function installBraveMac() {
  const embedded = embeddedInstaller('Brave-Browser-universal.pkg')
  if (embedded) {
    // Va embebido: no se baja nada ni se borra nada al terminar — el
    // archivo es parte de la app instalada.
    await installPkgElevated(embedded)
    return
  }
  const pkgPath = path.join(os.tmpdir(), 'Brave-Browser-universal.pkg')
  await downloadPkg(pkgPath)
  try {
    await installPkgElevated(pkgPath)
  } finally {
    fs.unlink(pkgPath, () => {})
  }
}

module.exports = { isBraveInstalledMac, installBraveMac, isBraveInstalledLinux, installBraveLinux, MAC_APP_PATH }
