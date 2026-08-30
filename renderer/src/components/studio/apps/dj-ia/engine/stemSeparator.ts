import type { StemBuffers, StemName } from './multiStemSource'
import { STEM_NAMES } from './multiStemSource'

const MODEL_SAMPLE_RATE = 44100

/**
 * Separación real de stems (IA, HT-Demucs) — reemplazo de la vieja
 * "PISTA" por cancelación de canal central (`karaokeProcessor.ts`,
 * ahora sin uso). El modelo corre en el proceso main de Electron (ver
 * `stemSeparation.js`/`stemWorker.js`), acá solo se prepara el audio.
 *
 * Recibe el `AudioBuffer` YA DECODIFICADO del plato (`bufferRef` del
 * motor) en vez de un `File` — así funciona sin importar de dónde
 * vino la pista (LOAD directo, Biblioteca, Auto DJ…), que no siempre
 * tienen el archivo original a mano (`getLoadedFile()` da `null` para
 * pistas de la Biblioteca, y ahí el botón quedaba sin reaccionar).
 * El modelo necesita 44.1kHz exacto — si el dispositivo real corre a
 * otra tasa (48kHz es común), se re-samplea acá con un
 * `OfflineAudioContext` antes de mandarlo.
 */
export async function separateStems(
  sourceBuffer: AudioBuffer,
  ctx: AudioContext,
  onProgress?: (evt: { phase: string; ratio: number }) => void,
): Promise<StemBuffers> {
  let decoded = sourceBuffer
  if (sourceBuffer.sampleRate !== MODEL_SAMPLE_RATE) {
    const resampleLen = Math.ceil(sourceBuffer.duration * MODEL_SAMPLE_RATE)
    const offline = new OfflineAudioContext(2, resampleLen, MODEL_SAMPLE_RATE)
    const src = offline.createBufferSource()
    src.buffer = sourceBuffer
    src.connect(offline.destination)
    src.start()
    decoded = await offline.startRendering()
  }
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
