'use strict'

/**
 * Corre como PROCESO HIJO aparte (`child_process.fork`, ver
 * `stemSeparation.js`) — así un crash del motor de IA no se lleva la
 * ventana ni el resto de la app. Recibe el mix ya decodificado a
 * 44.1kHz estéreo (el renderer lo prepara con un `OfflineAudioContext`,
 * ver `stemSeparator.ts`), corre el modelo ONNX real de HT-Demucs
 * (StemSplitio/htdemucs-onnx, fp16, MIT) y devuelve 4 stems reales:
 * voz, batería, bajo, resto.
 *
 * Una `InferenceSession` NUEVA por cada segmento de ~7.8s, en vez de
 * reusar una sola sesión para toda la canción — confirmado con pruebas
 * aisladas (sin Electron, sin worker_threads, con las dos variantes del
 * modelo y con varias versiones de `onnxruntime-node`) que en esta Mac
 * (Intel, backend CPU) la SEGUNDA llamada a `session.run()` sobre la
 * misma sesión crashea el binario nativo con `SIGTRAP` dentro de
 * `onnxruntime::BFCArena::Extend` — un bug real del motor nativo en
 * este entorno, no de este código. Crear sesión nueva por segmento
 * cuesta ~8s extra cada vez (con `graphOptimizationLevel: 'disabled'`,
 * que evita re-optimizar un grafo que ya viene optimizado del export),
 * pero corre confiable.
 */
const ort = require('onnxruntime-node')
const SESSION_OPTS = { executionProviders: ['cpu'], graphOptimizationLevel: 'disabled' }

const SEGMENT_SAMPLES = 343980 // ~7.8s a 44.1kHz — tamaño de entrada fijo del modelo
const OVERLAP_RATIO = 0.25
const OVERLAP_SAMPLES = Math.round(SEGMENT_SAMPLES * OVERLAP_RATIO)
const HOP_SAMPLES = SEGMENT_SAMPLES - OVERLAP_SAMPLES
// Orden real de salida del modelo (StemSplitio/htdemucs-onnx): drums, bass, other, vocals.
const MODEL_STEM_ORDER = ['bateria', 'bajo', 'resto', 'voz']

function buildSegmentWindow(isFirst, isLast) {
  const w = new Float32Array(SEGMENT_SAMPLES)
  w.fill(1)
  if (!isFirst) {
    for (let n = 0; n < OVERLAP_SAMPLES; n++) w[n] = n / OVERLAP_SAMPLES
  }
  if (!isLast) {
    for (let n = 0; n < OVERLAP_SAMPLES; n++) w[SEGMENT_SAMPLES - 1 - n] = n / OVERLAP_SAMPLES
  }
  return w
}

// `buf.byteOffset` no siempre es múltiplo de 4 (depende de cómo el IPC
// con `serialization: 'advanced'` reconstruye el `Buffer` del lado del
// hijo — visto real en la app empaquetada, no en dev) y una vista
// directa (`new Float32Array(buf.buffer, buf.byteOffset, ...)`) tira
// `RangeError` en ese caso. Copiar evita el problema sin importar el
// offset de origen.
function toFloat32(buf) {
  const out = new Float32Array(buf.byteLength / 4)
  Buffer.from(out.buffer).set(buf)
  return out
}

async function run(job) {
  const { modelPath, ch0, ch1, length } = job
  const in0 = toFloat32(ch0)
  const in1 = toFloat32(ch1)

  process.send({ type: 'progress', phase: 'loading-model', ratio: 0 })

  const segmentStarts = []
  for (let start = 0; start < length; start += HOP_SAMPLES) segmentStarts.push(start)

  // 4 stems x 2 canales, acumulador ponderado (overlap-add real, con
  // normalización por peso) + un acumulador de peso compartido entre
  // stems/canales porque la ventana es la misma para los 4.
  const accum = MODEL_STEM_ORDER.map(() => [new Float32Array(length), new Float32Array(length)])
  const weightSum = new Float32Array(length)

  for (let i = 0; i < segmentStarts.length; i++) {
    const start = segmentStarts[i]
    const isFirst = i === 0
    const isLast = i === segmentStarts.length - 1
    const window = buildSegmentWindow(isFirst, isLast)

    const segData = new Float32Array(2 * SEGMENT_SAMPLES)
    for (let n = 0; n < SEGMENT_SAMPLES; n++) {
      const srcIdx = start + n
      segData[n] = srcIdx < length ? in0[srcIdx] : 0
      segData[SEGMENT_SAMPLES + n] = srcIdx < length ? in1[srcIdx] : 0
    }

    let session
    try {
      session = await ort.InferenceSession.create(modelPath, SESSION_OPTS)
    } catch (err) {
      // El modelo descargado quedó corrupto (wifi cortada a mitad de
      // la descarga, etc.) — se borra acá mismo para que el próximo
      // intento lo baje de nuevo solo, en vez de fallar para siempre
      // con el mismo error críptico de protobuf.
      require('node:fs').rmSync(modelPath, { force: true })
      throw new Error(`DJIA_STEMS_MODEL_CORRUPTO: el modelo de IA estaba dañado, se borró — probá separar de nuevo (${String(err && err.message || err)})`)
    }
    const inputTensor = new ort.Tensor('float32', segData, [1, 2, SEGMENT_SAMPLES])
    const feeds = {}
    feeds[session.inputNames[0]] = inputTensor
    const results = await session.run(feeds)
    const out = results[session.outputNames[0]] // dims [1,4,2,SEGMENT_SAMPLES]
    const outData = out.data
    await session.release()

    for (let n = 0; n < SEGMENT_SAMPLES; n++) {
      const srcIdx = start + n
      if (srcIdx >= length) break
      const w = window[n]
      weightSum[srcIdx] += w
      for (let s = 0; s < 4; s++) {
        const base = s * 2 * SEGMENT_SAMPLES
        accum[s][0][srcIdx] += outData[base + n] * w
        accum[s][1][srcIdx] += outData[base + SEGMENT_SAMPLES + n] * w
      }
    }

    process.send({ type: 'progress', phase: 'separating', ratio: (i + 1) / segmentStarts.length })
  }

  const stems = {}
  for (let s = 0; s < 4; s++) {
    const name = MODEL_STEM_ORDER[s]
    const left = accum[s][0]
    const right = accum[s][1]
    for (let t = 0; t < length; t++) {
      const w = weightSum[t] > 1e-8 ? weightSum[t] : 1
      left[t] /= w
      right[t] /= w
    }
    // `serialization: 'advanced'` (ver `stemSeparation.js`) sabe mandar
    // `Buffer` real por IPC — a diferencia de `worker_threads`, un
    // proceso hijo no tiene transferencia sin copia, pero para esto
    // (unos cientos de MB, una sola vez) el costo de copiar es aceptable.
    stems[name] = { ch0: Buffer.from(left.buffer), ch1: Buffer.from(right.buffer) }
  }

  process.send({ type: 'done', stems, length })
}

process.on('message', (job) => {
  run(job).catch((err) => {
    process.send({ type: 'error', error: String((err && err.stack) || err) })
  })
})
