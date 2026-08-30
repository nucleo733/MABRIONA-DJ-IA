'use strict'

const { app, BrowserWindow, shell, Menu, dialog, ipcMain } = require('electron')
const path = require('node:path')
const http = require('node:http')
const fs = require('node:fs')
const { isBraveInstalledMac, installBraveMac } = require('./braveInstaller')
const { separateStems } = require('./stemSeparation')

// MATOKO DJ tiene su propio código del mezclador (renderer/, copia
// standalone del componente que también vive en mabriona.com) — no
// carga la web de MABRIONA Studio. Solo dos
// llamadas puntuales (búsqueda/verificación de YouTube) siguen yendo
// contra mabriona.com, porque ahí viven las claves secretas
// (Brave/YouTube Data API) que nunca deben embeberse en un binario
// público. Ver `ipcMain.handle('djia:search'|'djia:check', ...)`.
const MABRIONA_API_BASE = 'https://mabriona.com'

const MIME_TYPES = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.wasm': 'application/wasm',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.woff2': 'font/woff2',
  '.ico': 'image/x-icon',
}

process.on('uncaughtException', (err) => {
  console.error('[MATOKO DJ] error no manejado:', err)
})

let mainWindow = null
let rendererServer = null

function rendererRoot() {
  return path.join(app.getAppPath(), 'renderer', 'dist')
}

/**
 * Servidor HTTP local mínimo para servir el build del mezclador. Hace
 * falta un origen http(s) real (no `file://`) para que la YouTube
 * IFrame Player API funcione (usa `postMessage` entre orígenes).
 */
function startRendererServer() {
  const root = rendererRoot()
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const reqPath = decodeURIComponent((req.url || '/').split('?')[0])
      const filePath = path.join(root, reqPath === '/' ? 'index.html' : reqPath)
      if (!filePath.startsWith(root)) {
        res.writeHead(403).end()
        return
      }
      fs.readFile(filePath, (err, data) => {
        if (err) {
          fs.readFile(path.join(root, 'index.html'), (err2, html) => {
            if (err2) {
              res.writeHead(404).end('Not found')
              return
            }
            res.writeHead(200, { 'Content-Type': 'text/html' }).end(html)
          })
          return
        }
        res.writeHead(200, { 'Content-Type': MIME_TYPES[path.extname(filePath)] || 'application/octet-stream' }).end(data)
      })
    })
    server.on('error', reject)
    server.listen(0, '127.0.0.1', () => resolve(server))
  })
}

async function callMabrionaApi(pathAndQuery) {
  const res = await fetch(`${MABRIONA_API_BASE}${pathAndQuery}`)
  let data = null
  try {
    data = await res.json()
  } catch {
    // respuesta vacía o no-JSON — se devuelve `data: null` tal cual
  }
  return { ok: res.ok, status: res.status, data }
}

ipcMain.handle('djia:search', async (_evt, { query, safe }) => {
  try {
    return await callMabrionaApi(`/api/search?q=${encodeURIComponent(query)}${safe ? '&safe=1' : ''}`)
  } catch (err) {
    console.error('[MATOKO DJ] error buscando en YouTube:', err)
    return { ok: false, status: 0, data: null }
  }
})

ipcMain.handle('djia:check', async (_evt, { id }) => {
  try {
    return await callMabrionaApi(`/api/check?id=${encodeURIComponent(id)}`)
  } catch (err) {
    console.error('[MATOKO DJ] error verificando video de YouTube:', err)
    return { ok: false, status: 0, data: null }
  }
})

ipcMain.handle('djia:separateStems', async (evt, { ch0, ch1, length }) => {
  const stems = await separateStems(
    { userDataPath: app.getPath('userData'), ch0: new Float32Array(ch0), ch1: new Float32Array(ch1), length },
    (progress) => evt.sender.send('djia:stemsProgress', progress),
  )
  // `stems[*].ch0/ch1` pueden llegar como `Buffer` real (recién separado,
  // del proceso hijo) o como `ArrayBuffer` (leído de caché en disco) — el
  // renderer espera siempre `ArrayBuffer` plano para armar los
  // `AudioBuffer`, así que se normaliza acá, en el borde real hacia afuera.
  const normalized = {}
  for (const [name, { ch0: a, ch1: b }] of Object.entries(stems)) {
    const toArrayBuffer = (x) => (Buffer.isBuffer(x) ? x.buffer.slice(x.byteOffset, x.byteOffset + x.byteLength) : x)
    normalized[name] = { ch0: toArrayBuffer(a), ch1: toArrayBuffer(b) }
  }
  return normalized
})

/**
 * Sin auto-actualización real (Squirrel.Mac exige firma de código, que
 * esta app todavía no tiene) — esto solo avisa si hay una versión más
 * nueva publicada en GitHub Releases, para que quien ya la descargó
 * sepa que existe y vaya a bajarla de nuevo.
 */
ipcMain.handle('djia:checkForUpdate', async () => {
  try {
    const res = await fetch('https://api.github.com/repos/nucleo733/MATOKO-DJ/releases/latest', {
      headers: { Accept: 'application/vnd.github+json' },
    })
    if (!res.ok) return { updateAvailable: false }
    const { tag_name } = await res.json()
    const latest = String(tag_name || '').replace(/^v/, '')
    const current = app.getVersion()
    const latestParts = latest.split('.').map(Number)
    const currentParts = current.split('.').map(Number)
    let isNewer = false
    for (let i = 0; i < Math.max(latestParts.length, currentParts.length); i++) {
      const l = latestParts[i] || 0
      const c = currentParts[i] || 0
      if (l !== c) {
        isNewer = l > c
        break
      }
    }
    return isNewer ? { updateAvailable: true, latestVersion: latest, url: 'https://mabriona.com/dj-ia' } : { updateAvailable: false }
  } catch (err) {
    console.error('[MATOKO DJ] no se pudo chequear si hay una versión nueva:', err)
    return { updateAvailable: false }
  }
})

async function createWindow() {
  if (!rendererServer) {
    rendererServer = await startRendererServer()
  }
  const port = rendererServer.address().port

  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1100,
    minHeight: 700,
    backgroundColor: '#000000',
    title: 'MATOKO DJ',
    icon: path.join(__dirname, 'build', 'icon.icns'),
    // Barra de título propia (violeta→celeste, con el logo) en vez de la
    // franja gris nativa — solo macOS, ahí `titleBarStyle: 'hidden'` deja
    // los botones de semáforo flotando sin más trabajo. La barra en sí
    // (BrandBar) vive en el renderer, en renderer/src/main.tsx.
    ...(process.platform === 'darwin'
      ? { titleBarStyle: 'hidden', trafficLightPosition: { x: 14, y: 14 } }
      : {}),
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      preload: path.join(__dirname, 'preload.js'),
    },
  })

  mainWindow.loadURL(`http://127.0.0.1:${port}`)

  // Cualquier link que se quiera abrir en una pestaña nueva (ej. algo
  // externo) se manda al navegador del sistema en vez de abrir una
  // segunda ventana de Electron sin controles.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })

  mainWindow.on('closed', () => {
    mainWindow = null
  })
}

function buildMenu() {
  const isMac = process.platform === 'darwin'
  const template = [
    ...(isMac ? [{ role: 'appMenu' }] : []),
    {
      label: 'MATOKO DJ',
      submenu: [isMac ? { role: 'close' } : { role: 'quit' }],
    },
    { role: 'editMenu' },
    { role: 'windowMenu' },
  ]
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

/**
 * En Windows, Brave se instala solo durante la instalación de MATOKO DJ
 * (ver `installer/checkBrave.nsh`), sin preguntar. En Mac, el build es
 * una `.app` suelta sin instalador con permisos elevados, así que ese
 * mismo chequeo se hace acá, al arrancar la app — si falta Brave, se
 * instala directo (macOS va a pedir la contraseña de administrador
 * para poder instalar, eso no se puede saltear), sin ofrecer la
 * opción de continuar sin Brave.
 */
async function ensureBraveInstalledMac() {
  if (process.platform !== 'darwin') return
  if (isBraveInstalledMac()) return
  await dialog.showMessageBox({
    type: 'info',
    title: 'Instalando Brave',
    message: 'MATOKO DJ necesita el navegador Brave.',
    detail: 'Se va a instalar ahora — macOS va a pedir tu contraseña de administrador.',
    buttons: ['Continuar'],
  })
  try {
    await installBraveMac()
  } catch (err) {
    console.error('[MATOKO DJ] no se pudo instalar Brave automáticamente:', err)
    await dialog.showMessageBox({
      type: 'warning',
      title: 'No se pudo instalar Brave',
      message: 'No se pudo instalar Brave automáticamente.',
      detail: 'Podés descargarlo manualmente desde brave.com.',
    })
  }
}

app.whenReady().then(async () => {
  buildMenu()
  await ensureBraveInstalledMac()
  createWindow()
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow()
})

app.on('before-quit', () => {
  rendererServer?.close()
})
