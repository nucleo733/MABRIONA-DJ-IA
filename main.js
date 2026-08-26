'use strict'

const { app, BrowserWindow, shell, Menu, dialog, ipcMain } = require('electron')
const path = require('node:path')
const { isBraveInstalled, launchBraveTo } = require('./braveClient')

// La app de escritorio de DJ IA es una ventana nativa que carga la
// misma pantalla del mezclador que ya vive en producción
// (mabriona.com/dj-ia-app, una página standalone sin el header/nav de
// MABRIONA STUDIO). No duplica el motor de audio ni el código del
// mezclador — así queda siempre igual de actualizado que la web, sin
// mantener dos copias del mismo código.
const DJ_IA_URL = 'https://mabriona.com/dj-ia-app'
const BRAVE_DOWNLOAD_URL = 'https://brave.com/download/'
const SEARCH_PAGE_URL = 'https://www.mabriona.com/dj-ia-buscar'

// Decisión de producto de la Dirección: Brave real (Brave Software) es
// el navegador que usa DJ IA para buscar/elegir música de YouTube —
// reemplaza la integración anterior con MABRIONA Browser. Como no hay
// forma de correr código propio dentro de Brave, la elección real
// vuelve acá vía este protocolo (`mabriona-djia://pick?...`), que abre
// una página real de mabriona.com (`/dj-ia-buscar`, ver ese repo).
const DJIA_PROTOCOL = 'mabriona-djia'
/** @type {Map<string, { resolve: (r: any) => void, timer: NodeJS.Timeout }>} */
const pendingPicks = new Map()

function handleDjiaPickUrl(rawUrl) {
  let parsed
  try {
    parsed = new URL(rawUrl)
  } catch {
    return
  }
  const isPick = parsed.hostname === 'pick' || parsed.pathname.replace(/^\/+/, '') === 'pick'
  if (!isPick) return
  const requestId = parsed.searchParams.get('requestId')
  const videoId = parsed.searchParams.get('videoId')
  const video = videoId
    ? {
        id: videoId,
        title: parsed.searchParams.get('title') || '',
        channel: parsed.searchParams.get('channel') || null,
        thumbnail: parsed.searchParams.get('thumbnail') || null,
        durationSec: parsed.searchParams.get('durationSec') ? Number(parsed.searchParams.get('durationSec')) : null,
      }
    : null

  // Camino web (sin la app de escritorio pidiendo esto por IPC): la
  // página de búsqueda venía con `back` (la URL real de la pestaña que
  // originó la búsqueda) — se le devuelve el resultado real por
  // `?ytpick=<base64>`, igual que hacía antes MABRIONA Browser.
  const back = parsed.searchParams.get('back')
  if (back) {
    if (video) {
      const payload = encodeURIComponent(Buffer.from(JSON.stringify(video)).toString('base64'))
      shell.openExternal(`${back}${back.includes('?') ? '&' : '?'}ytpick=${payload}`)
    }
    return
  }

  if (!requestId || !pendingPicks.has(requestId)) return
  const { resolve, timer } = pendingPicks.get(requestId)
  clearTimeout(timer)
  pendingPicks.delete(requestId)
  resolve(video ? { ok: true, video } : { ok: false, error: 'NO_VIDEO' })
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.focus()
  }
}

app.setAsDefaultProtocolClient(DJIA_PROTOCOL)

process.on('uncaughtException', (err) => {
  console.error('[MABRIONA DJ IA] error no manejado:', err)
})

let mainWindow = null

// mac: llega vía `open-url` en cualquier momento de vida de la app.
if (process.platform === 'darwin') {
  app.on('open-url', (event, url) => {
    event.preventDefault()
    handleDjiaPickUrl(url)
  })
} else {
  // Windows/Linux: el SO abre una SEGUNDA instancia con la URL como
  // argv — se pide el lock de instancia única para que esa segunda
  // instancia le pase la URL a la que ya está corriendo, en vez de
  // abrir una ventana nueva de DJ IA. Igual que el patrón ya probado
  // en MABRIONA Browser, deliberadamente sin tocar mac.
  const gotLock = app.requestSingleInstanceLock()
  if (!gotLock) {
    app.quit()
  } else {
    app.on('second-instance', (_event, argv) => {
      const url = argv.find((a) => a.startsWith(`${DJIA_PROTOCOL}://`))
      if (url) handleDjiaPickUrl(url)
      if (mainWindow) {
        if (mainWindow.isMinimized()) mainWindow.restore()
        mainWindow.focus()
      }
    })
  }
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1100,
    minHeight: 700,
    backgroundColor: '#000000',
    title: 'MABRIONA DJ IA',
    icon: path.join(__dirname, 'build', 'icon.icns'),
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      preload: path.join(__dirname, 'preload.js'),
    },
  })

  mainWindow.loadURL(DJ_IA_URL)

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
      label: 'MABRIONA',
      submenu: [isMac ? { role: 'close' } : { role: 'quit' }],
    },
    { role: 'editMenu' },
    { role: 'windowMenu' },
  ]
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

/**
 * Búsqueda/selección real de videos de YouTube vía Brave real (Brave
 * Software), instalado en el sistema — decisión de producto de la
 * Dirección, reemplaza la integración anterior con MABRIONA Browser.
 * Abre Brave en una página real de mabriona.com (`/dj-ia-buscar`), y
 * espera a que esa elección vuelva por `mabriona-djia://pick?...`
 * (ver `handleDjiaPickUrl` arriba).
 */
ipcMain.handle('brave:pick', async (_event, query) => {
  if (typeof query !== 'string' || !query.trim()) return { ok: false, error: 'MISSING_QUERY' }
  if (!isBraveInstalled()) {
    if (mainWindow) {
      const choice = await dialog.showMessageBox(mainWindow, {
        type: 'info',
        title: 'Brave no está instalado',
        message: 'MABRIONA DJ AI necesita el navegador Brave para buscar música en YouTube.',
        detail: 'Podés descargarlo gratis desde brave.com.',
        buttons: ['Descargar Brave', 'Cancelar'],
        defaultId: 0,
        cancelId: 1,
      })
      if (choice.response === 0) shell.openExternal(BRAVE_DOWNLOAD_URL)
    }
    return { ok: false, error: 'NOT_INSTALLED' }
  }
  const requestId = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`
  const url = `${SEARCH_PAGE_URL}?requestId=${requestId}&q=${encodeURIComponent(query.trim())}`
  if (!launchBraveTo(url)) return { ok: false, error: 'LAUNCH_FAILED' }
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      pendingPicks.delete(requestId)
      resolve({ ok: false, error: 'TIMEOUT' })
    }, 15 * 60 * 1000)
    pendingPicks.set(requestId, { resolve, timer })
  })
})

app.whenReady().then(() => {
  buildMenu()
  createWindow()
  // Arranque en frío en Windows/Linux: el SO puede lanzar la app recién
  // ahora con la URL del protocolo ya en argv (no hay una instancia
  // previa que dispare `second-instance`).
  if (process.platform !== 'darwin') {
    const coldUrl = process.argv.find((a) => a.startsWith(`${DJIA_PROTOCOL}://`))
    if (coldUrl) handleDjiaPickUrl(coldUrl)
  }
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow()
})
