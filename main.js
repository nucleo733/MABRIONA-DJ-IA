'use strict'

const { app, BrowserWindow, shell, Menu } = require('electron')
const path = require('node:path')

// La app de escritorio de DJ IA es una ventana nativa que carga la
// misma pantalla del mezclador que ya vive en producción
// (mabriona.com/dj-ia-app, una página standalone sin el header/nav de
// MABRIONA STUDIO). No duplica el motor de audio ni el código del
// mezclador — así queda siempre igual de actualizado que la web, sin
// mantener dos copias del mismo código.
const DJ_IA_URL = 'https://mabriona.com/dj-ia-app'

process.on('uncaughtException', (err) => {
  console.error('[MABRIONA DJ IA] error no manejado:', err)
})

let mainWindow = null
let browserWindow = null

// Panel de navegación integrado (MABRIONA Search) — para buscar y
// encontrar música sin salir de la app. Es una ventana propia con su
// propia barra de direcciones (browser-window.html), no una copia del
// navegador completo MABRIONA Browser (ese es otro producto aparte).
function openBrowserWindow() {
  if (browserWindow) {
    browserWindow.show()
    browserWindow.focus()
    return
  }
  browserWindow = new BrowserWindow({
    width: 1100,
    height: 760,
    minWidth: 640,
    minHeight: 480,
    backgroundColor: '#0a0a0a',
    title: 'Buscar música — MABRIONA',
    parent: mainWindow ?? undefined,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false, // el <webview> del panel de búsqueda lo requiere
      webviewTag: true,
    },
  })
  browserWindow.loadFile(path.join(__dirname, 'browser-window.html'))
  browserWindow.on('closed', () => {
    browserWindow = null
  })
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
      submenu: [
        {
          label: 'Buscar música…',
          accelerator: 'CmdOrCtrl+B',
          click: () => openBrowserWindow(),
        },
        { type: 'separator' },
        isMac ? { role: 'close' } : { role: 'quit' },
      ],
    },
    { role: 'editMenu' },
    { role: 'windowMenu' },
  ]
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

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
