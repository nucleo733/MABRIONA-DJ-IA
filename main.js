'use strict'

const { app, BrowserWindow, shell, Menu, dialog } = require('electron')
const path = require('node:path')
const { isBraveInstalledMac, installBraveMac } = require('./braveInstaller')

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
 * En Windows, Brave se instala solo durante la instalación de DJ IA
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
    message: 'MABRIONA DJ IA necesita el navegador Brave.',
    detail: 'Se va a instalar ahora — macOS va a pedir tu contraseña de administrador.',
    buttons: ['Continuar'],
  })
  try {
    await installBraveMac()
  } catch (err) {
    console.error('[MABRIONA DJ IA] no se pudo instalar Brave automáticamente:', err)
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
