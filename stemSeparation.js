'use strict'

/**
 * Separación real de stems (voz/batería/bajo/resto) con IA — reemplaza
 * la vieja "PISTA" por cancelación de canal central (que sonaba mal:
 * debilitaba el bajo/bombo y dejaba voz de fondo si no estaba centrada).
 * Usa HT-Demucs real convertido a ONNX (StemSplitio/htdemucs-onnx,
 * fp16, MIT), corrido con `onnxruntime-node` en un PROCESO HIJO real
 * (`child_process.fork`, ver `stemWorker.js`, mismo binario de
 * Electron pero con `ELECTRON_RUN_AS_NODE=1` para correr como Node
 * puro) — así, si el motor de IA crashea (ver el comentario real en
 * `stemWorker.js` sobre el bug nativo confirmado de `onnxruntime-node`
 * en esta Mac), se pierde solo ese proceso hijo y no toda la app.
 *
 * El modelo (166MB) no viene empaquetado en el instalador — se baja una
 * sola vez, la primera vez que alguien usa "STEMS", y queda cacheado en
 * `userData/models/`. El resultado de separar una canción también se
 * cachea (`userData/stemsCache/<hash>/`) para no volver a correr el
 * modelo si se recarga la misma canción.
 */
const { fork } = require('node:child_process')
const path = require('node:path')
const fs = require('node:fs')
const fsp = require('node:fs/promises')
const crypto = require('node:crypto')
const { Readable } = require('node:stream')
const { pipeline } = require('node:stream/promises')

const MODEL_URL = 'https://huggingface.co/StemSplitio/htdemucs-onnx/resolve/main/htdemucs_fp16weights.onnx'
const STEM_NAMES = ['voz', 'bateria', 'bajo', 'resto']

function modelPath(userDataPath) {
  return path.join(userDataPath, 'models', 'htdemucs_fp16weights.onnx')
}

async function ensureModelDownloaded(userDataPath, onProgress) {
  const dest = modelPath(userDataPath)
  if (fs.existsSync(dest)) return dest
  await fsp.mkdir(path.dirname(dest), { recursive: true })
  const tmp = `${dest}.part`
  const res = await fetch(MODEL_URL, { redirect: 'follow' })
  if (!res.ok || !res.body) throw new Error(`DJIA_STEMS_MODEL_DOWNLOAD_FAILED: HTTP ${res.status}`)
  const total = Number(res.headers.get('content-length') || 0)
  let received = 0
  let lastReported = 0
  const source = Readable.fromWeb(res.body)
  source.on('data', (chunk) => {
    received += chunk.length
    // Avisar cada ~1% en vez de por cada chunk de red — con miles de
    // chunks chicos, mandar progreso al renderer en cada uno saturaba
    // el hilo principal y hacía parecer la descarga trabada.
    if (total > 0 && received - lastReported > total / 100) {
      lastReported = received
      onProgress?.(received / total)
    }
  })
  await pipeline(source, fs.createWriteStream(tmp))
  // Chequeo real de integridad — sin esto, una descarga cortada a
  // mitad de camino (wifi que se corta, etc.) quedaba guardada como
  // si estuviera completa, y el modelo fallaba después con un error
  // de "Protobuf parsing failed" bien críptico, sin poder recuperarse
  // solo (el archivo ya existía, así que nunca se volvía a intentar).
  const finalSize = (await fsp.stat(tmp)).size
  if (total > 0 && finalSize !== total) {
    await fsp.unlink(tmp).catch(() => undefined)
    throw new Error(`DJIA_STEMS_MODEL_DOWNLOAD_INCOMPLETE: se bajaron ${finalSize} de ${total} bytes — probá de nuevo`)
  }
  await fsp.rename(tmp, dest)
  return dest
}

function hashPcm(ch0, ch1) {
  const hash = crypto.createHash('sha1')
  hash.update(Buffer.from(ch0.buffer, ch0.byteOffset, ch0.byteLength))
  hash.update(Buffer.from(ch1.buffer, ch1.byteOffset, ch1.byteLength))
  return hash.digest('hex')
}

function cacheDir(userDataPath, hash) {
  return path.join(userDataPath, 'stemsCache', hash)
}

async function readCachedStems(userDataPath, hash, length) {
  const dir = cacheDir(userDataPath, hash)
  const metaPath = path.join(dir, 'meta.json')
  if (!fs.existsSync(metaPath)) return null
  try {
    const meta = JSON.parse(await fsp.readFile(metaPath, 'utf8'))
    if (meta.length !== length) return null
    const stems = {}
    for (const name of STEM_NAMES) {
      const ch0 = new Float32Array((await fsp.readFile(path.join(dir, `${name}.ch0.f32`))).buffer)
      const ch1 = new Float32Array((await fsp.readFile(path.join(dir, `${name}.ch1.f32`))).buffer)
      stems[name] = { ch0: ch0.buffer, ch1: ch1.buffer }
    }
    return stems
  } catch {
    return null
  }
}

async function writeCachedStems(userDataPath, hash, length, stems) {
  const dir = cacheDir(userDataPath, hash)
  await fsp.mkdir(dir, { recursive: true })
  await fsp.writeFile(path.join(dir, 'meta.json'), JSON.stringify({ length }))
  for (const name of STEM_NAMES) {
    await fsp.writeFile(path.join(dir, `${name}.ch0.f32`), Buffer.from(stems[name].ch0))
    await fsp.writeFile(path.join(dir, `${name}.ch1.f32`), Buffer.from(stems[name].ch1))
  }
}

/**
 * @param {{ userDataPath: string, ch0: Float32Array, ch1: Float32Array, length: number }} input
 * @param {(evt: { phase: string, ratio: number }) => void} onProgress
 */
async function separateStems({ userDataPath, ch0, ch1, length }, onProgress) {
  const hash = hashPcm(ch0, ch1)
  const cached = await readCachedStems(userDataPath, hash, length)
  if (cached) {
    onProgress?.({ phase: 'cache', ratio: 1 })
    return cached
  }

  const model = await ensureModelDownloaded(userDataPath, (ratio) => onProgress?.({ phase: 'downloading-model', ratio }))

  const stems = await new Promise((resolve, reject) => {
    const child = fork(path.join(__dirname, 'stemWorker.js'), [], {
      execPath: process.execPath,
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
      serialization: 'advanced', // soporta Buffer real por IPC, no solo JSON
      stdio: 'pipe',
    })
    child.stdout?.on('data', (d) => console.log('[MATOKO DJ][stems-worker]', d.toString().trimEnd()))
    child.stderr?.on('data', (d) => console.error('[MATOKO DJ][stems-worker]', d.toString().trimEnd()))
    child.on('message', (msg) => {
      if (msg.type === 'progress') onProgress?.({ phase: msg.phase, ratio: msg.ratio })
      else if (msg.type === 'done') { resolve(msg.stems); child.kill() }
      else if (msg.type === 'error') { reject(new Error(msg.error)); child.kill() }
    })
    child.on('error', reject)
    child.on('exit', (code, signal) => {
      console.log('[MATOKO DJ][stems] proceso hijo terminó, code =', code, 'signal =', signal)
      if (code !== 0 || signal) reject(new Error(`DJIA_STEMS_WORKER_CRASHED: code=${code} signal=${signal}`))
    })
    child.send({ modelPath: model, ch0: Buffer.from(ch0.buffer, ch0.byteOffset, ch0.byteLength), ch1: Buffer.from(ch1.buffer, ch1.byteOffset, ch1.byteLength), length })
  })

  await writeCachedStems(userDataPath, hash, length, stems)
  return stems
}

module.exports = { separateStems }
