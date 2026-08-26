'use strict'

/**
 * Cliente real del puente de MABRIONA Browser — Integración oficial
 * MABRIONA Browser + MABRIONA DJ AI (decisión de producto: MABRIONA
 * Browser es el navegador oficial del ecosistema; DJ AI nunca abre un
 * navegador de terceros ni mantiene un `<webview>` propio paralelo).
 *
 * Protocolo real: HTTP simple contra `127.0.0.1:<puerto>` (ver
 * `MABRIONA-BROWSER/bridge/djiaBridge.js`) — puerto y token reales se
 * leen de `djia-bridge.json`, en la carpeta de datos REAL de MABRIONA
 * Browser (no la de esta app — se calcula a mano porque
 * `app.getPath('userData')` de Electron solo resuelve la carpeta de
 * la app actual).
 */

const http = require('node:http')
const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')
const { spawn } = require('node:child_process')

const BROWSER_PRODUCT_NAME = 'MABRIONA Browser'
const MAC_APP_PATH = '/Applications/MABRIONA Browser.app'

function browserUserDataPath() {
  if (process.platform === 'darwin') return path.join(os.homedir(), 'Library', 'Application Support', BROWSER_PRODUCT_NAME)
  if (process.platform === 'win32') return path.join(process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'), BROWSER_PRODUCT_NAME)
  return path.join(process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config'), BROWSER_PRODUCT_NAME)
}

function bridgeFilePath() {
  return path.join(browserUserDataPath(), 'djia-bridge.json')
}

function readBridgeInfo() {
  try {
    return JSON.parse(fs.readFileSync(bridgeFilePath(), 'utf-8'))
  } catch {
    return null
  }
}

function windowsExeCandidates() {
  return [
    path.join(process.env.LOCALAPPDATA || '', 'Programs', 'mabriona-browser', 'MABRIONA Browser.exe'),
    path.join(process.env.PROGRAMFILES || 'C:\\Program Files', 'MABRIONA Browser', 'MABRIONA Browser.exe'),
  ]
}

/**
 * Linux se distribuye como AppImage (sin ruta fija de "instalación" —
 * ver `docs/INTEGRACION-DJ-AI.md`, sección Linux): se confía en
 * `MABRIONA_BROWSER_APPIMAGE` (una variable de entorno real que el
 * usuario/el `.desktop` real que se genera al integrar el AppImage al
 * sistema puede exportar) o, en su defecto, en que el archivo del
 * puente ya exista (evidencia real de que corrió al menos una vez).
 */
function isBrowserInstalled() {
  if (process.platform === 'darwin') return fs.existsSync(MAC_APP_PATH)
  if (process.platform === 'win32') return windowsExeCandidates().some((p) => fs.existsSync(p))
  return !!process.env.MABRIONA_BROWSER_APPIMAGE || fs.existsSync(bridgeFilePath())
}

function launchBrowser() {
  if (process.platform === 'darwin') {
    spawn('open', ['-a', MAC_APP_PATH], { detached: true, stdio: 'ignore' }).unref()
    return
  }
  if (process.platform === 'win32') {
    const exe = windowsExeCandidates().find((p) => fs.existsSync(p))
    if (exe) spawn(exe, [], { detached: true, stdio: 'ignore' }).unref()
    return
  }
  if (process.env.MABRIONA_BROWSER_APPIMAGE) spawn(process.env.MABRIONA_BROWSER_APPIMAGE, [], { detached: true, stdio: 'ignore' }).unref()
}

function httpRequest(info, method, pathName, payload) {
  return new Promise((resolve, reject) => {
    const body = payload ? JSON.stringify(payload) : null
    const req = http.request(
      {
        hostname: '127.0.0.1',
        port: info.port,
        path: pathName,
        method,
        timeout: 5000,
        headers: body ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) } : undefined,
      },
      (res) => {
        let data = ''
        res.on('data', (chunk) => (data += chunk))
        res.on('end', () => {
          try {
            resolve({ status: res.statusCode, body: data ? JSON.parse(data) : {} })
          } catch (err) {
            reject(err)
          }
        })
      },
    )
    req.on('error', reject)
    req.on('timeout', () => {
      req.destroy()
      reject(new Error('MABRIONA_BROWSER_BRIDGE_TIMEOUT'))
    })
    if (body) req.write(body)
    req.end()
  })
}

async function pingBridge(info) {
  try {
    const r = await httpRequest(info, 'GET', `/result?requestId=__ping__&token=${info.token}`)
    return r.status === 404 || r.status === 200
  } catch {
    return false
  }
}

function waitForBridgeReady(timeoutMs) {
  return new Promise((resolve) => {
    const deadline = Date.now() + timeoutMs
    const tryRead = () => {
      const info = readBridgeInfo()
      if (info && info.port) {
        resolve(info)
        return
      }
      if (Date.now() > deadline) {
        resolve(null)
        return
      }
      setTimeout(tryRead, 200)
    }
    tryRead()
  })
}

/** Verifica instalación real y arranca MABRIONA Browser si hace falta — nunca instala/lanza Brave, Chrome ni Firefox. */
async function ensureBrowserReady() {
  const existing = readBridgeInfo()
  if (existing && (await pingBridge(existing))) return { installed: true, info: existing }
  if (!isBrowserInstalled()) return { installed: false, info: null }
  launchBrowser()
  const info = await waitForBridgeReady(8000)
  return { installed: true, info }
}

/**
 * Búsqueda + selección real dentro de MABRIONA Browser — nunca dentro
 * de un `<webview>` propio de esta app. El usuario elige a su ritmo
 * real (el timeout es una red de seguridad, no un límite de UX).
 */
async function pickYoutubeVideo(query, { pollIntervalMs = 900, timeoutMs = 15 * 60 * 1000, ensureReady = ensureBrowserReady } = {}) {
  const ready = await ensureReady()
  if (!ready.installed) return { ok: false, error: 'NOT_INSTALLED' }
  if (!ready.info) return { ok: false, error: 'BRIDGE_UNAVAILABLE' }
  const info = ready.info
  let pickRes
  try {
    pickRes = await httpRequest(info, 'POST', '/pick', { token: info.token, query })
  } catch {
    return { ok: false, error: 'BRIDGE_UNREACHABLE' }
  }
  if (pickRes.status !== 202) return { ok: false, error: pickRes.body.error || 'PICK_FAILED' }
  const requestId = pickRes.body.requestId
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    let r
    try {
      r = await httpRequest(info, 'GET', `/result?requestId=${requestId}&token=${info.token}`)
    } catch {
      return { ok: false, error: 'BRIDGE_UNREACHABLE' }
    }
    if (r.body.status === 'done') return { ok: true, video: r.body.video }
    if (r.body.status === 'error') return { ok: false, error: r.body.message }
    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs))
  }
  return { ok: false, error: 'TIMEOUT' }
}

module.exports = { isBrowserInstalled, ensureBrowserReady, pickYoutubeVideo, bridgeFilePath, browserUserDataPath }
