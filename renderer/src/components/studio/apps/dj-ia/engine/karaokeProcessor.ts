import { FFmpeg } from '@ffmpeg/ffmpeg'
import { toBlobURL } from '@ffmpeg/util'
// Mismos subpaths reales que usa Music Studio para su propio ffmpeg.wasm
// (ver `music-studio/engine/audio/formatEncoders.ts`) — instancia
// separada a propósito: cada feature carga su propio core WASM (~25 MB)
// perezosamente, recién cuando el usuario pide crear una pista de
// karaoke por primera vez, nunca en el arranque de la app.
import ffmpegCoreURL from '@ffmpeg/core?url'
import ffmpegWasmURL from '@ffmpeg/core/wasm?url'

/**
 * Karaoke real por cancelación de canal central — la técnica clásica
 * de "quitar voz": en la mayoría de las mezclas de pop/rock la voz
 * está centrada (igual en los dos canales), mientras que los
 * instrumentos están repartidos en estéreo. Restar un canal del otro
 * (`c0-c1` / `c1-c0`) cancela lo que es idéntico en ambos — casi
 * siempre la voz — y deja lo que es distinto — la base. Es DSP real
 * vía ffmpeg.wasm (el filtro de audio `pan`, real de ffmpeg, no
 * inventado), no separación por IA — eso necesitaría un modelo
 * entrenado, mucho más pesado de bajar y de procesar en el navegador.
 *
 * Limitación real, no un bug: si la voz no está centrada en la mezcla
 * original, si la pista es mono, o es una grabación en vivo, el
 * resultado no queda tan limpio — puede quedar algo de voz de fondo,
 * y el bajo/bombo (que también suelen estar centrados) se debilitan
 * un poco junto con la voz.
 */
let ffmpegInstance: FFmpeg | null = null
let loadingPromise: Promise<FFmpeg> | null = null

async function getFFmpeg(): Promise<FFmpeg> {
  if (ffmpegInstance?.loaded) return ffmpegInstance
  if (!loadingPromise) {
    loadingPromise = (async () => {
      const ffmpeg = new FFmpeg()
      await ffmpeg.load({
        coreURL: await toBlobURL(ffmpegCoreURL, 'text/javascript'),
        wasmURL: await toBlobURL(ffmpegWasmURL, 'application/wasm'),
      })
      ffmpegInstance = ffmpeg
      return ffmpeg
    })()
  }
  return loadingPromise
}

/** Deja el codificador listo de antemano, para poder mostrar "preparando…" antes del primer uso real. */
export function preloadKaraokeEncoder(): Promise<void> {
  return getFFmpeg().then(() => undefined)
}

function extOf(name: string): string {
  const m = name.match(/\.[^./]+$/)
  return m ? m[0] : '.dat'
}

let callCounter = 0

/**
 * Genera un `File` WAV real con la voz cancelada del centro, listo
 * para cargarse en un plato como cualquier otra pista (mismo
 * `loadFile` de siempre — EQ, loop, hot cues, BPM, todo funciona
 * igual porque sigue siendo audio real decodificado, no un efecto en
 * vivo que dependa de este archivo).
 */
export async function createKaraokeTrack(file: File, onProgress?: (ratio: number) => void): Promise<File> {
  const ffmpeg = await getFFmpeg()
  const callId = callCounter++
  const inputName = `karaoke-in-${callId}${extOf(file.name)}`
  const outputName = `karaoke-out-${callId}.wav`

  const handleProgress = onProgress
    ? ({ progress }: { progress: number }) => onProgress(Math.min(1, Math.max(0, progress)))
    : null
  if (handleProgress) ffmpeg.on('progress', handleProgress)

  try {
    await ffmpeg.writeFile(inputName, new Uint8Array(await file.arrayBuffer()))
    // -vn: si el archivo es un video (o tiene una pista de video
    // adjunta, como una carátula embebida en un mp3), se descarta —
    // un .wav no puede contener video y ffmpeg fallaba con esos
    // archivos. -ac 2: fuerza estéreo antes del filtro `pan` — sin
    // esto, un archivo mono (que no tiene canal `c1`) hacía fallar el
    // filtro en vez de simplemente no tener nada que cancelar.
    // -c:a pcm_f32le: PCM de 32 bits en punto flotante — sin esto,
    // ffmpeg elige por defecto 16 bits para un .wav, lo que perdía
    // calidad real si el archivo original era de más resolución
    // (24/32 bits). Con float32 nunca se pierde precisión extra en
    // este paso, sin importar la calidad del archivo de origen.
    const exitCode = await ffmpeg.exec(['-i', inputName, '-vn', '-ac', '2', '-af', 'pan=stereo|c0=c0-c1|c1=c1-c0', '-c:a', 'pcm_f32le', outputName])
    if (exitCode !== 0) {
      throw new Error(`DJIA_KARAOKE_FAILED: ffmpeg devolvió el código ${exitCode} al generar la pista de karaoke.`)
    }
    const data = await ffmpeg.readFile(outputName)
    const name = `${file.name.replace(/\.[^./]+$/, '')} (Karaoke).wav`
    return new File([new Uint8Array(data as Uint8Array)], name, { type: 'audio/wav' })
  } finally {
    if (handleProgress) ffmpeg.off('progress', handleProgress)
    await ffmpeg.deleteFile(inputName).catch(() => undefined)
    await ffmpeg.deleteFile(outputName).catch(() => undefined)
  }
}
