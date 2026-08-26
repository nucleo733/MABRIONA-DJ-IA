'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const http = require('node:http')
const { pickYoutubeVideo } = require('../browserBridgeClient')

/**
 * Servidor real mínimo que imita el protocolo real de
 * `MABRIONA-BROWSER/bridge/djiaBridge.js` — no un mock del cliente:
 * un server HTTP real escuchando en loopback, exactamente lo que
 * `pickYoutubeVideo` habla por HTTP de verdad.
 */
function startFakeBridgeServer({ token, resultAfterMs = 200, video = null, errorMessage = null }) {
  let requestCount = 0
  const server = http.createServer((req, res) => {
    let body = ''
    req.on('data', (c) => (body += c))
    req.on('end', () => {
      const url = new URL(req.url, 'http://127.0.0.1')
      if (req.method === 'POST' && url.pathname === '/pick') {
        requestCount += 1
        const requestId = 'req-' + requestCount
        setTimeout(() => {}, 0)
        res.writeHead(202, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ requestId }))
        return
      }
      if (req.method === 'GET' && url.pathname === '/result') {
        const startedAt = server.__startedAt || (server.__startedAt = Date.now())
        const elapsed = Date.now() - startedAt
        res.writeHead(200, { 'Content-Type': 'application/json' })
        if (elapsed < resultAfterMs) {
          res.end(JSON.stringify({ status: 'pending' }))
        } else if (errorMessage) {
          res.end(JSON.stringify({ status: 'error', message: errorMessage }))
        } else {
          res.end(JSON.stringify({ status: 'done', video }))
        }
        return
      }
      res.writeHead(404).end()
    })
  })
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve(server))
  })
}

test('pickYoutubeVideo real: espera (poll real) hasta que el usuario elige, y devuelve la metadata real', async () => {
  const token = 'token-real-de-prueba'
  const video = { id: 'dQw4w9WgXcQ', title: 'Canción real', channel: 'Canal real', thumbnail: 'https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg', durationSec: 213 }
  const server = await startFakeBridgeServer({ token, resultAfterMs: 400, video })
  const port = server.address().port
  try {
    const result = await pickYoutubeVideo('bachata dominicana', {
      pollIntervalMs: 100,
      timeoutMs: 5000,
      ensureReady: async () => ({ installed: true, info: { port, token } }),
    })
    assert.equal(result.ok, true)
    assert.deepEqual(result.video, video)
  } finally {
    server.close()
  }
})

test('pickYoutubeVideo real: si MABRIONA Browser no está instalado, no intenta la búsqueda', async () => {
  const result = await pickYoutubeVideo('bachata', {
    ensureReady: async () => ({ installed: false, info: null }),
  })
  assert.equal(result.ok, false)
  assert.equal(result.error, 'NOT_INSTALLED')
})

test('pickYoutubeVideo real: si el bridge real devuelve error, se propaga tal cual (nunca se inventa un resultado)', async () => {
  const token = 'token-real'
  const server = await startFakeBridgeServer({ token, resultAfterMs: 100, errorMessage: 'MABRIONA_BROWSER_TAB_CLOSED' })
  const port = server.address().port
  try {
    const result = await pickYoutubeVideo('algo', {
      pollIntervalMs: 50,
      timeoutMs: 5000,
      ensureReady: async () => ({ installed: true, info: { port, token } }),
    })
    assert.equal(result.ok, false)
    assert.equal(result.error, 'MABRIONA_BROWSER_TAB_CLOSED')
  } finally {
    server.close()
  }
})

test('pickYoutubeVideo real: timeout real si el usuario nunca elige (no se cuelga para siempre)', async () => {
  const token = 'token-real'
  const server = await startFakeBridgeServer({ token, resultAfterMs: 999999 })
  const port = server.address().port
  try {
    const result = await pickYoutubeVideo('algo', {
      pollIntervalMs: 50,
      timeoutMs: 250,
      ensureReady: async () => ({ installed: true, info: { port, token } }),
    })
    assert.equal(result.ok, false)
    assert.equal(result.error, 'TIMEOUT')
  } finally {
    server.close()
  }
})
