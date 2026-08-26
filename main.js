'use strict'

const { app, BrowserWindow, shell, Menu, dialog, ipcMain } = require('electron')
const path = require('node:path')
const { isBrowserInstalled, pickYoutubeVideo } = require('./browserBridgeClient')

// La app de escritorio de DJ IA es una ventana nativa que carga la
// misma pantalla del mezclador que ya vive en producción
// (mabriona.com/dj-ia-app, una página standalone sin el header/nav de
// MABRIONA STUDIO). No duplica el motor de audio ni el código del
// mezclador — así queda siempre igual de actualizado que la web, sin
// mantener dos copias del mismo código.
const DJ_IA_URL = 'https://mabriona.com/dj-ia-app'
const BROWSER_DOWNLOAD_URL = 'https://mabriona.com/browser'

process.on('uncaughtException', (err) => {
  console.error('[MABRIONA DJ IA] error no manejado:', err)
})

let mainWindow = null

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
 * Integración oficial MABRIONA Browser + MABRIONA DJ AI
 * (`docs/INTEGRACION-DJ-AI.md`): la búsqueda/selección real de videos
 * de YouTube pasa SIEMPRE por una pestaña real de MABRIONA Browser —
 * nunca por un `<webview>` propio de esta app (el panel viejo
 * "Buscar música" con `<webview>` + Brave, `browser-window.html`, se
 * eliminó a propósito por esta misma fase) ni por Brave/Chrome/Firefox
 * instalados en el sistema.
 */
ipcMain.handle('mabriona-browser:pick', async (_event, query) => {
  if (typeof query !== 'string' || !query.trim()) return { ok: false, error: 'MISSING_QUERY' }
  if (!isBrowserInstalled()) {
    if (mainWindow) {
      const choice = await dialog.showMessageBox(mainWindow, {
        type: 'info',
        title: 'MABRIONA Browser no está instalado',
        message: 'MABRIONA DJ AI necesita MABRIONA Browser para buscar música en YouTube.',
        detail: 'Es el navegador oficial de MABRIONA — no se usa Brave, Chrome ni Firefox para esto.',
        buttons: ['Descargar MABRIONA Browser', 'Cancelar'],
        defaultId: 0,
        cancelId: 1,
      })
      if (choice.response === 0) shell.openExternal(BROWSER_DOWNLOAD_URL)
    }
    return { ok: false, error: 'NOT_INSTALLED' }
  }
  return pickYoutubeVideo(query.trim())
})

app.whenReady().then(() => {
  buildMenu()
  createWindow()
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow()
})
