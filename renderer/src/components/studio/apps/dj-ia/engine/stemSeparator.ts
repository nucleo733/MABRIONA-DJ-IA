import type { StemBuffers, StemName } from './multiStemSource'
import { STEM_NAMES } from './multiStemSource'

const MODEL_SAMPLE_RATE = 44100

/**
 * Separación real de stems (IA, HT-Demucs) — reemplazo de la vieja
 * "PISTA" por cancelación de canal central (`karaokeProcessor.ts`,
 * ahora sin uso). El modelo corre en el proceso main de Electron (ver
 * `stemSeparation.js`/`stemWorker.js`), acá solo se prepara el audio
 * (decodificado a 44.1kHz estéreo, sample rate fijo que espera el
 * modelo, independiente del sample rate real del dispositivo) y se
 * arma el `AudioBuffer` final de cada stem con el `AudioContext` real
 * del motor para poder reproducirlo.
 */
export async function separateStems(
  file: File,
  ctx: AudioContext,
  onProgress?: (evt: { phase: string; ratio: number }) => void,
): Promise<StemBuffers> {
  const arrayBuffer = await file.arrayBuffer()
  // Un `OfflineAudioContext` fuerza el decode a 44.1kHz estéreo sin
  // importar a qué sample rate corre el dispositivo real — el modelo
  // necesita esa tasa exacta.
  const probeCtx = new OfflineAudioContext(2, 1, MODEL_SAMPLE_RATE)
  const decoded = await probeCtx.decodeAudioData(arrayBuffer)
  const length = decoded.length
  const ch0 = new Float32Array(length)
  const ch1 = new Float32Array(length)
  ch0.set(decoded.getChannelData(0))
  ch1.set(decoded.numberOfChannels > 1 ? decoded.getChannelData(1) : decoded.getChannelData(0))

  const unsubscribe = onProgress ? window.djia.onStemsProgress(onProgress) : null
  let raw: Record<StemName, { ch0: ArrayBuffer; ch1: ArrayBuffer }>
  try {
    raw = (await window.djia.separateStems({ ch0: ch0.buffer, ch1: ch1.buffer, length })) as typeof raw
  } finally {
    unsubscribe?.()
  }

  const stems = {} as StemBuffers
  for (const name of STEM_NAMES) {
    const buffer = ctx.createBuffer(2, length, MODEL_SAMPLE_RATE)
    buffer.copyToChannel(new Float32Array(raw[name].ch0), 0)
    buffer.copyToChannel(new Float32Array(raw[name].ch1), 1)
    stems[name] = buffer
  }
  return stems
}
