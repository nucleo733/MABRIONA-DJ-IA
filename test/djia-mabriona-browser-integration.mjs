// Prueba real E2E — Integración oficial MABRIONA Browser + MABRIONA DJ AI
// (docs/INTEGRACION-DJ-AI.md). Lanza MABRIONA Browser DE VERDAD (Electron
// real, repo hermano ../MABRIONA-BROWSER) con Playwright, y ejercita el
// protocolo real del puente (`bridge/djiaBridge.js`) de punta a punta
// contra el cliente real de esta app (`browserBridgeClient.js`) — nada
// mockeado: server HTTP real, pestaña real, navegación real a YouTube,
// metadata real extraída de la página real.
//
// No lanza la propia ventana de MABRIONA DJ AI (esa carga
// https://mabriona.com/dj-ia-app, producción real — probarla acá
// duplicaría lo que ya cubren los *-check.mjs de MABRIONA-STUDIO sin
// aportar nada nuevo sobre el puente en sí). Lo que sí es exclusivo de
// esta integración, y lo que este script prueba de verdad, es el
// protocolo real entre las dos apps de escritorio.
import { _electron as electron } from 'playwright'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import fs from 'node:fs'

const require = createRequire(import.meta.url)
const { pickYoutubeVideo, bridgeFilePath } = require('../browserBridgeClient.js')

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const browserAppRoot = path.join(__dirname, '..', '..', 'MABRIONA-BROWSER')

const results = []
function check(label, ok, extra) {
  results.push({ label, ok })
  console.log(`${ok ? '✅' : '❌'} ${label}${extra ? ' — ' + extra : ''}`)
}

// Video real, estable, público — sirve solo para probar que la
// extracción real de metadata funciona contra una página real de
// YouTube, no para afirmar nada sobre este video en particular.
const KNOWN_VIDEO_ID = 'dQw4w9WgXcQ'

if (!fs.existsSync(browserAppRoot)) {
  console.log(`❌ No se encontró el repo hermano MABRIONA-BROWSER en ${browserAppRoot} — no se puede correr la integración real.`)
  process.exit(1)
}

console.log('=== Lanzando MABRIONA Browser real (Electron + Chromium real) ===')
// El binario real de Electron es el que ya usa MABRIONA Browser en su
// propio repo (mismo criterio que sus propios tests, `test/smoke.mjs`)
// — no el `electron` que instaló este repo hermano, que es solo para
// correr ESTA app de escritorio, no para lanzar la otra.
const browserElectronBin = path.join(browserAppRoot, 'node_modules', '.bin', 'electron')
// Este entorno de desarrollo tiene ELECTRON_RUN_AS_NODE=1 seteado (ver
// MABRIONA-BROWSER/test/smoke.mjs) — sin sacarlo, el binario de
// Electron arranca como Node plano en vez de la app real.
const launchEnv = { ...process.env }
delete launchEnv.ELECTRON_RUN_AS_NODE
const browserApp = await electron.launch({ args: [browserAppRoot], cwd: browserAppRoot, executablePath: browserElectronBin, env: launchEnv })

try {
  // El bridge real escribe su archivo apenas el navegador está listo — se espera con reintentos
  // reales en vez de asumir un tiempo fijo.
  const bridgePath = bridgeFilePath()
  const deadline = Date.now() + 8000
  let bridgeInfo = null
  while (Date.now() < deadline) {
    if (fs.existsSync(bridgePath)) {
      bridgeInfo = JSON.parse(fs.readFileSync(bridgePath, 'utf-8'))
      break
    }
    await new Promise((r) => setTimeout(r, 150))
  }
  check('El bridge real de MABRIONA Browser escribió puerto+token reales', !!bridgeInfo)
  if (!bridgeInfo) throw new Error('sin bridgeInfo, no se puede continuar')

  console.log('=== DJ AI real pide buscar (protocolo HTTP real contra el bridge) ===')
  const pickPromise = pickYoutubeVideo('bachata dominicana', {
    pollIntervalMs: 400,
    timeoutMs: 20000,
    ensureReady: async () => ({ installed: true, info: bridgeInfo }),
  })

  // Le damos tiempo real a que la pestaña real se abra en MABRIONA Browser.
  await new Promise((r) => setTimeout(r, 1500))

  const tabUrlAfterPick = await browserApp.evaluate(({ BrowserWindow }) => {
    const views = BrowserWindow.getAllWindows()[0]?.getBrowserViews() || []
    return views[views.length - 1]?.webContents.getURL() || null
  })
  check('MABRIONA Browser abrió una pestaña real de búsqueda de YouTube', !!tabUrlAfterPick && tabUrlAfterPick.includes('youtube.com/results'), tabUrlAfterPick)

  // Simula al usuario real navegando desde los resultados hasta un video real
  // (evita depender de qué resultado concreto devuelve YouTube hoy, que puede
  // cambiar — lo que se prueba acá es la extracción real de metadata y el
  // protocolo real del puente, no el ranking de búsqueda de YouTube). Se
  // navega real DESDE ADENTRO de la página (como un clic de verdad en un
  // link), no reemplazando la carga desde el proceso principal — así no
  // compite con la navegación real de la búsqueda que puede seguir en curso.
  console.log('=== Simulando la elección real del usuario (navega a un video real) ===')
  await browserApp.evaluate(
    ({ BrowserWindow }, videoId) => {
      const views = BrowserWindow.getAllWindows()[0].getBrowserViews()
      const view = views[views.length - 1]
      return view.webContents.executeJavaScript(`location.href = 'https://www.youtube.com/watch?v=${videoId}'`).catch(() => {})
    },
    KNOWN_VIDEO_ID,
  )
  await new Promise((r) => setTimeout(r, 4000))

  const buttonAppeared = await browserApp.evaluate(({ BrowserWindow }) => {
    const views = BrowserWindow.getAllWindows()[0].getBrowserViews()
    const view = views[views.length - 1]
    return view.webContents.executeJavaScript("!!document.getElementById('__mabriona_djia_pick_btn')")
  })
  check('El botón real "Usar en DJ AI" se inyectó en la página real del video', buttonAppeared)

  console.log('=== Simulando el clic real del usuario en "Usar en DJ AI" ===')
  await browserApp.evaluate(({ BrowserWindow }) => {
    const views = BrowserWindow.getAllWindows()[0].getBrowserViews()
    const view = views[views.length - 1]
    return view.webContents.executeJavaScript("document.getElementById('__mabriona_djia_pick_btn').click()")
  })

  const result = await pickPromise
  check('DJ AI real recibió el resultado real (no un timeout, no un error)', result.ok, JSON.stringify(result))
  if (result.ok) {
    check('El videoId real coincide con el video real que se abrió', result.video.id === KNOWN_VIDEO_ID, result.video.id)
    check('El título real llegó (no inventado, extraído de la página real)', typeof result.video.title === 'string' && result.video.title.length > 0, result.video.title)
    check('La miniatura real llegó (URL real de i.ytimg.com)', typeof result.video.thumbnail === 'string' && result.video.thumbnail.includes('ytimg.com'), result.video.thumbnail)
    check('La duración real llegó (segundos reales, no null)', typeof result.video.durationSec === 'number' && result.video.durationSec > 0, result.video.durationSec)
  }
} finally {
  await browserApp.close()
}

const failed = results.filter((r) => !r.ok)
console.log(`\n${results.length - failed.length}/${results.length} verificaciones reales OK`)
process.exit(failed.length === 0 ? 0 : 1)
