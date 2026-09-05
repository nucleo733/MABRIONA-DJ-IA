'use strict'

/**
 * Descarga los instaladores oficiales reales de Brave a `vendor/` para
 * que queden EMBEBIDOS dentro del instalador de MATOKO DJ.
 * ============================================================
 * Decisión de producto: el instalador de MATOKO DJ lleva Brave adentro,
 * así la instalación funciona aunque la computadora no tenga internet
 * en ese momento. Igual se sigue comprobando si Brave ya está: si ya
 * lo tiene, no se instala nada — el archivo embebido simplemente no se
 * usa.
 *
 * Los binarios NO se guardan en el repo (pesan 150-250 MB cada uno, muy
 * por encima del límite de 100 MB por archivo de GitHub): se bajan acá,
 * en el momento de compilar, desde el release oficial real de Brave
 * Software (github.com/brave/brave-browser — nunca un mirror de
 * terceros), y `vendor/` está en .gitignore.
 *
 * Se engancha como `build.beforePack` real de electron-builder, así que
 * corre solo en cada `npm run build`, y también se puede correr a mano
 * con `node scripts/fetchBrave.js`.
 */

const fs = require('node:fs')
const path = require('node:path')
const { spawn } = require('node:child_process')

const VENDOR_DIR = path.join(__dirname, '..', 'vendor')
const RELEASE_BASE = 'https://github.com/brave/brave-browser/releases/latest/download'

/**
 * Qué instalador de Brave necesita cada build. Los `.deb`/`.rpm` llevan
 * la versión real en el nombre del asset, así que no se pueden pedir por
 * `latest/download` con un nombre fijo — esos se resuelven contra la API
 * de releases (ver `resolveLinuxAssets`).
 */
const FIXED_ASSETS = {
  darwin: ['Brave-Browser-universal.pkg'],
  win32: ['BraveBrowserStandaloneSetup.exe'],
}

function download(url, destPath) {
  return new Promise((resolve, reject) => {
    const partial = `${destPath}.part`
    const curl = spawn('curl', ['-L', '-f', '--retry', '3', '-o', partial, url], { stdio: 'inherit' })
    curl.on('error', reject)
    curl.on('exit', (code) => {
      if (code !== 0 || !fs.existsSync(partial)) {
        fs.rmSync(partial, { force: true })
        reject(new Error(`No se pudo descargar ${url} (curl salió con código ${code})`))
        return
      }
      // Se renombra recién al final para que una descarga cortada a la
      // mitad nunca quede tomada como archivo válido en el próximo build.
      fs.renameSync(partial, destPath)
      resolve()
    })
  })
}

function fetchJson(url) {
  return new Promise((resolve, reject) => {
    const curl = spawn('curl', ['-fsSL', url])
    let out = ''
    curl.stdout.on('data', (chunk) => { out += chunk })
    curl.on('error', reject)
    curl.on('exit', (code) => {
      if (code !== 0) reject(new Error(`No se pudo consultar ${url} (código ${code})`))
      else resolve(JSON.parse(out))
    })
  })
}

/** Nombres reales de los assets `.deb`/`.rpm` del último release (llevan versión). */
async function resolveLinuxAssets() {
  const release = await fetchJson('https://api.github.com/repos/brave/brave-browser/releases/latest')
  const names = release.assets.map((a) => a.name)
  const pick = (re) => names.find((n) => re.test(n))
  const deb = pick(/^brave-browser_[\d.]+_amd64\.deb$/)
  const rpm = pick(/^brave-browser-[\d.]+-1\.x86_64\.rpm$/)
  if (!deb || !rpm) throw new Error('El release de Brave no trae los paquetes .deb/.rpm esperados')
  return [deb, rpm]
}

async function main(platformArg) {
  const platform = platformArg || process.platform
  const assets = platform === 'linux'
    ? await resolveLinuxAssets()
    : FIXED_ASSETS[platform]

  if (!assets) {
    console.log(`[fetchBrave] plataforma ${platform} sin Brave embebido — nada que bajar.`)
    return
  }

  fs.mkdirSync(VENDOR_DIR, { recursive: true })

  for (const asset of assets) {
    const dest = path.join(VENDOR_DIR, asset)
    if (fs.existsSync(dest)) {
      console.log(`[fetchBrave] ya está ${asset} — no se vuelve a bajar.`)
      continue
    }
    console.log(`[fetchBrave] bajando ${asset}…`)
    await download(`${RELEASE_BASE}/${asset}`, dest)
  }

  // El instalador de Linux y el arranque en Mac buscan el archivo por un
  // nombre fijo, sin versión — se deja una copia con ese nombre para no
  // tener que tocar el código en cada release de Brave.
  if (platform === 'linux') {
    for (const [asset, estable] of [[assets[0], 'brave-browser.deb'], [assets[1], 'brave-browser.rpm']]) {
      fs.copyFileSync(path.join(VENDOR_DIR, asset), path.join(VENDOR_DIR, estable))
    }
  }

  console.log('[fetchBrave] listo.')
}

/** electron-builder llama a esto como `beforePack` (recibe el contexto del build). */
module.exports = async function beforePack(context) {
  await main(context?.electronPlatformName)
}

if (require.main === module) {
  // A mano: `node scripts/fetchBrave.js [darwin|win32|linux]` — sin
  // argumento, baja lo de esta misma computadora.
  main(process.argv[2]).catch((err) => {
    console.error('[fetchBrave]', err.message)
    process.exit(1)
  })
}
