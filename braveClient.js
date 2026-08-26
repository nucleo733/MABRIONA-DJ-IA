'use strict'

/**
 * Cliente real del navegador Brave (Brave Software) — decisión de
 * producto explícita de la Dirección: DJ IA usa Brave real, instalado
 * en el sistema, como buscador de YouTube (reemplaza la integración
 * anterior con MABRIONA Browser). Nunca corre código propio dentro de
 * Brave — la búsqueda/selección pasa por una página real de
 * mabriona.com (`/dj-ia-buscar`) que Brave muestra como cualquier
 * página, y que devuelve la elección a esta app vía el protocolo
 * `mabriona-djia://pick?...` (ver `main.js`).
 */

const fs = require('node:fs')
const path = require('node:path')
const { spawn } = require('node:child_process')

const MAC_APP_PATH = '/Applications/Brave Browser.app'

function windowsExeCandidates() {
  return [
    path.join(process.env.LOCALAPPDATA || '', 'BraveSoftware', 'Brave-Browser', 'Application', 'brave.exe'),
    path.join(process.env.PROGRAMFILES || 'C:\\Program Files', 'BraveSoftware', 'Brave-Browser', 'Application', 'brave.exe'),
    path.join(process.env['PROGRAMFILES(X86)'] || 'C:\\Program Files (x86)', 'BraveSoftware', 'Brave-Browser', 'Application', 'brave.exe'),
  ]
}

function linuxExeCandidates() {
  return ['/usr/bin/brave-browser', '/usr/bin/brave-browser-stable', '/opt/brave.com/brave/brave', '/snap/bin/brave']
}

function isBraveInstalled() {
  if (process.platform === 'darwin') return fs.existsSync(MAC_APP_PATH)
  if (process.platform === 'win32') return windowsExeCandidates().some((p) => fs.existsSync(p))
  return linuxExeCandidates().some((p) => fs.existsSync(p))
}

/** Abre Brave real directo en la URL dada — nunca el navegador default del sistema. */
function launchBraveTo(url) {
  if (process.platform === 'darwin') {
    if (!fs.existsSync(MAC_APP_PATH)) return false
    spawn('open', ['-a', 'Brave Browser', url], { detached: true, stdio: 'ignore' }).unref()
    return true
  }
  if (process.platform === 'win32') {
    const exe = windowsExeCandidates().find((p) => fs.existsSync(p))
    if (!exe) return false
    spawn(exe, [url], { detached: true, stdio: 'ignore' }).unref()
    return true
  }
  const exe = linuxExeCandidates().find((p) => fs.existsSync(p))
  if (!exe) return false
  spawn(exe, [url], { detached: true, stdio: 'ignore' }).unref()
  return true
}

module.exports = { isBraveInstalled, launchBraveTo, windowsExeCandidates, linuxExeCandidates, MAC_APP_PATH }
