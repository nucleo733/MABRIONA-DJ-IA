'use strict'

const { app, BrowserWindow, shell } = require('electron')
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

app.whenReady().then(createWindow)

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow()
})
