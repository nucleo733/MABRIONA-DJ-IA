import { useCallback, useEffect, useRef, useState } from 'react'
import type { BeatGrid, ColorFxType, EnergyProfile, EnergyWindow, EqBand, HotCue, KeyDetection, LoopRegion, PadMode, StructureAnalysis, Track } from '../types'
import { HOTCUE_SLOTS, KEYBOARD_SEMITONES, LOOP_LENGTHS } from '../types'
import { loadTrack as loadTrackFromDb, saveTrack } from './trackStorage'
import { MultiStemSource, STEM_NAMES } from './multiStemSource'
import type { StemBuffers, StemName } from './multiStemSource'
import { separateStems as runStemSeparation } from './stemSeparator'

function readLS<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key)
    return raw != null ? (JSON.parse(raw) as T) : fallback
  } catch {
    return fallback
  }
}

function writeLS(key: string, value: unknown) {
  try { localStorage.setItem(key, JSON.stringify(value)) } catch { /* localStorage lleno o bloqueado, no es crítico */ }
}

const PEAK_BUCKETS = 300
const EQ_LOW_HZ = 200
const EQ_HIGH_HZ = 3200
const DEFAULT_BPM = 120

const PAD_FX_PRESETS: { type: ColorFxType; amount: number }[] = [
  { type: 'dubecho', amount: 0.9 },
  { type: 'space', amount: 0.85 },
  { type: 'crush', amount: 0.7 },
  { type: 'pitch', amount: 0.9 },
  { type: 'noise', amount: 0.6 },
  { type: 'filter', amount: 0.95 },
  { type: 'filter', amount: -0.95 },
  { type: 'dubecho', amount: 0.5 },
]

/**
 * Frame real capturado del video (no un ícono genérico) — se usa solo
 * para mostrar "qué es" el archivo cargado en la pantalla del plato;
 * la reproducción/mezcla sigue siendo 100% el audio decodificado
 * (`decodeAudioData`), este `<video>` es descartable y nunca se
 * conecta al grafo de Web Audio.
 */
function captureVideoThumbnail(file: File): Promise<string | null> {
  return new Promise((resolve) => {
    const video = document.createElement('video')
    video.preload = 'metadata'
    video.muted = true
    video.playsInline = true
    const url = URL.createObjectURL(file)
    video.src = url
    const finish = (result: string | null) => { URL.revokeObjectURL(url); resolve(result) }
    video.onloadeddata = () => {
      video.currentTime = Math.min(1, (video.duration || 0) / 4)
    }
    video.onseeked = () => {
      try {
        const canvas = document.createElement('canvas')
        canvas.width = video.videoWidth || 320
        canvas.height = video.videoHeight || 180
        const c2d = canvas.getContext('2d')
        if (!c2d) { finish(null); return }
        c2d.drawImage(video, 0, 0, canvas.width, canvas.height)
        finish(canvas.toDataURL('image/jpeg', 0.7))
      } catch { finish(null) }
    }
    video.onerror = () => finish(null)
  })
}

export function computePeaks(buffer: AudioBuffer): number[] {
  const data = buffer.getChannelData(0)
  const bucketSize = Math.max(1, Math.floor(data.length / PEAK_BUCKETS))
  const peaks: number[] = []
  for (let i = 0; i < PEAK_BUCKETS; i++) {
    const start = i * bucketSize
    let max = 0
    for (let j = start; j < start + bucketSize && j < data.length; j++) {
      const v = Math.abs(data[j])
      if (v > max) max = v
    }
    peaks.push(max)
  }
  return peaks
}

/**
 * BPM real de la pista (no un valor inventado): energía del audio en
 * ventanas de ~10ms, realce de golpes (derivada positiva), y
 * autocorrelación de esa envolvente entre 60 y 180 BPM para
 * encontrar el período que más se repite — el mismo principio que
 * usa cualquier detector de tempo real.
 */
export function detectBpm(buffer: AudioBuffer): number {
  const data = buffer.getChannelData(0)
  const sr = buffer.sampleRate
  const hop = Math.max(1, Math.floor(sr * 0.01)) // ventanas de 10ms
  const frames = Math.floor(data.length / hop)
  const energy = new Float32Array(frames)
  for (let i = 0; i < frames; i++) {
    let sum = 0
    const start = i * hop
    for (let j = start; j < start + hop && j < data.length; j++) sum += data[j] * data[j]
    energy[i] = sum
  }
  const onset = new Float32Array(frames)
  for (let i = 1; i < frames; i++) onset[i] = Math.max(0, energy[i] - energy[i - 1])

  const framesPerSec = 1 / 0.01
  const minLag = Math.round((60 / 180) * framesPerSec)
  const maxLag = Math.round((60 / 60) * framesPerSec)
  let bestLag = minLag
  let bestScore = -Infinity
  for (let lag = minLag; lag <= maxLag; lag++) {
    let score = 0
    for (let i = 0; i + lag < frames; i++) score += onset[i] * onset[i + lag]
    if (score > bestScore) { bestScore = score; bestLag = lag }
  }
  const bpm = 60 / (bestLag / framesPerSec)
  return Math.round(bpm * 10) / 10
}

/**
 * Grid de beats real (Fase 4 — DJ Engine). Reutiliza `detectBpm` para
 * el período (no se busca el tempo dos veces) y agrega lo que ese
 * escalar no da: la FASE real — en qué segundo cae el primer beat —
 * probando cada corrimiento posible dentro de un período completo y
 * quedándose con el que mejor se alinea con la energía/onset real del
 * audio (mismo principio de autocorrelación que `detectBpm`, aplicado
 * a la fase en vez de al período).
 *
 * NO incluye downbeat/compás real: eso necesitaría detección de barra
 * (patrones armónicos/tímbricos), que no está implementada — declarar
 * "downbeat" sin eso sería inventar precisión que no existe (regla de
 * realidad del prompt maestro), así que queda fuera de esta fase.
 * (`BeatGrid` vive en `../types` para que `musicLibraryRepository.ts`
 * lo comparta sin import circular.)
 */
export function detectBeatGrid(buffer: AudioBuffer): BeatGrid {
  const bpm = detectBpm(buffer)
  const periodSec = 60 / bpm
  const data = buffer.getChannelData(0)
  const sr = buffer.sampleRate
  const hop = Math.max(1, Math.floor(sr * 0.01))
  const frames = Math.floor(data.length / hop)
  const energy = new Float32Array(frames)
  for (let i = 0; i < frames; i++) {
    let sum = 0
    const start = i * hop
    for (let j = start; j < start + hop && j < data.length; j++) sum += data[j] * data[j]
    energy[i] = sum
  }
  const onset = new Float32Array(frames)
  for (let i = 1; i < frames; i++) onset[i] = Math.max(0, energy[i] - energy[i - 1])

  const framesPerSec = 1 / 0.01
  const periodFrames = Math.max(1, Math.round(periodSec * framesPerSec))
  let bestPhase = 0
  let bestScore = -Infinity
  for (let phase = 0; phase < periodFrames; phase++) {
    let score = 0
    for (let i = phase; i < frames; i += periodFrames) score += onset[i]
    if (score > bestScore) { bestScore = score; bestPhase = phase }
  }
  return { firstBeatSec: bestPhase / framesPerSec, periodSec }
}

/** Redondea un tiempo (segundos) al beat real más cercano del grid. Sin grid (ninguno detectado todavía), devuelve el tiempo tal cual — nunca inventa una posición. */
export function nearestBeatTime(t: number, grid: BeatGrid | null): number {
  if (!grid) return t
  const beatsFromFirst = (t - grid.firstBeatSec) / grid.periodSec
  const nearestIndex = Math.max(0, Math.round(beatsFromFirst))
  return grid.firstBeatSec + nearestIndex * grid.periodSec
}

const PITCH_CLASSES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']

// Perfiles tonales reales — Krumhansl & Kessler (1982), publicados
// (no valores inventados): estabilidad tonal relativa de cada grado
// de la escala respecto del tonic, medida empíricamente.
const MAJOR_PROFILE = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88]
const MINOR_PROFILE = [6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17]

// Rueda Camelot real (estándar de mezcla armónica de DJ) por tonic+modo.
const CAMELOT_MAJOR: Record<string, string> = { C: '8B', G: '9B', D: '10B', A: '11B', E: '12B', B: '1B', 'F#': '2B', 'C#': '3B', 'G#': '4B', 'D#': '5B', 'A#': '6B', F: '7B' }
const CAMELOT_MINOR: Record<string, string> = { A: '8A', E: '9A', B: '10A', 'F#': '11A', 'C#': '12A', 'G#': '1A', 'D#': '2A', 'A#': '3A', F: '4A', C: '5A', G: '6A', D: '7A' }

function midiToFreq(midi: number): number {
  return 440 * Math.pow(2, (midi - 69) / 12)
}

/** Magnitud real de una frecuencia exacta en una señal — algoritmo de Goertzel, la forma estándar de medir UNA frecuencia puntual sin calcular una FFT completa. */
function goertzelMagnitude(samples: Float32Array, targetFreq: number, sampleRate: number): number {
  const n = samples.length
  const k = Math.round((n * targetFreq) / sampleRate)
  const omega = (2 * Math.PI * k) / n
  const coeff = 2 * Math.cos(omega)
  let s0 = 0, s1 = 0, s2 = 0
  for (let i = 0; i < n; i++) {
    s0 = samples[i] + coeff * s1 - s2
    s2 = s1
    s1 = s0
  }
  const real = s1 - s2 * Math.cos(omega)
  const imag = s2 * Math.sin(omega)
  return Math.sqrt(real * real + imag * imag)
}

function pearsonCorrelation(a: Float32Array, b: number[]): number {
  const n = a.length
  let meanA = 0
  for (let i = 0; i < n; i++) meanA += a[i]
  meanA /= n
  const meanB = b.reduce((s, v) => s + v, 0) / n
  let num = 0, denA = 0, denB = 0
  for (let i = 0; i < n; i++) {
    const da = a[i] - meanA
    const db = b[i] - meanB
    num += da * db
    denA += da * da
    denB += db * db
  }
  const den = Math.sqrt(denA * denB)
  return den === 0 ? 0 : num / den
}

/**
 * Detección real de tonalidad (Fase 5 — DJ Engine). Chroma real (12
 * bins, energía por clase de altura) medido con Goertzel sobre las
 * frecuencias exactas de C2 a B5 (4 octavas reales) de una ventana
 * representativa del track (hasta 45s del medio — analizar el archivo
 * entero no cambiaría el resultado de forma relevante y sí el tiempo
 * de análisis), decimada 4x antes de Goertzel (el rango de interés
 * para clase de altura no necesita el sample rate completo). El
 * chroma se correlaciona contra los 24 perfiles tonales reales
 * (Krumhansl-Kessler, mayor/menor × 12 tonics) — el de mayor
 * correlación gana. Sin detección de acordes/progresión: es
 * key-finding clásico sobre el contenido armónico global del audio,
 * el mismo principio que usa cualquier detector de tonalidad real.
 */
export function detectKey(buffer: AudioBuffer): KeyDetection {
  const data = buffer.getChannelData(0)
  const sr = buffer.sampleRate
  const windowSec = Math.min(45, buffer.duration)
  const windowSamples = Math.max(1, Math.floor(windowSec * sr))
  const startSample = Math.max(0, Math.floor((data.length - windowSamples) / 2))
  const window = data.subarray(startSample, startSample + windowSamples)

  const decimation = 4
  const decimated = new Float32Array(Math.max(1, Math.floor(window.length / decimation)))
  for (let i = 0; i < decimated.length; i++) {
    let sum = 0
    for (let j = 0; j < decimation; j++) sum += window[i * decimation + j]
    decimated[i] = sum / decimation
  }
  const decimatedRate = sr / decimation

  const chroma = new Float32Array(12)
  for (let midi = 36; midi <= 83; midi++) { // C2..B5 real, 4 octavas
    const freq = midiToFreq(midi)
    if (freq >= decimatedRate / 2) continue
    chroma[midi % 12] += goertzelMagnitude(decimated, freq, decimatedRate)
  }

  let bestTonic = 0
  let bestScale: 'major' | 'minor' = 'major'
  let bestScore = -Infinity
  for (let t = 0; t < 12; t++) {
    const rotatedMajor = Array.from({ length: 12 }, (_, i) => MAJOR_PROFILE[(i - t + 12) % 12])
    const rotatedMinor = Array.from({ length: 12 }, (_, i) => MINOR_PROFILE[(i - t + 12) % 12])
    const scoreMajor = pearsonCorrelation(chroma, rotatedMajor)
    const scoreMinor = pearsonCorrelation(chroma, rotatedMinor)
    if (scoreMajor > bestScore) { bestScore = scoreMajor; bestTonic = t; bestScale = 'major' }
    if (scoreMinor > bestScore) { bestScore = scoreMinor; bestTonic = t; bestScale = 'minor' }
  }

  const tonic = PITCH_CLASSES[bestTonic]
  const camelot = (bestScale === 'major' ? CAMELOT_MAJOR : CAMELOT_MINOR)[tonic]
  return { tonic, scale: bestScale, camelot, confidence: Math.round(bestScore * 100) / 100 }
}

/**
 * Análisis real de energía (Fase 6 — DJ Engine): por cada ventana de
 * 1s se mide RMS real, pico real, y zero-crossing rate real (ZCR —
 * proxy clásico y real de "densidad espectral"/brillo: más cruces por
 * cero por segundo indica más contenido de alta frecuencia; no es un
 * espectrograma completo, pero es una medida real sobre la señal, no
 * inventada). El rango dinámico general es pico/RMS reales en dB.
 * `curve` queda lista para que una fase futura de DJ Intelligence
 * (Fase 20/23) use la progresión de energía real del track — esta
 * fase solo calcula y persiste, no hay UI ni motor de decisión
 * todavía. (`EnergyWindow`/`EnergyProfile` viven en `../types` por el
 * mismo motivo que `BeatGrid`/`KeyDetection`.)
 */
export function computeEnergyProfile(buffer: AudioBuffer, windowSec = 1): EnergyProfile {
  const data = buffer.getChannelData(0)
  const sr = buffer.sampleRate
  const windowSamples = Math.max(1, Math.floor(windowSec * sr))
  const numWindows = Math.max(1, Math.ceil(data.length / windowSamples))
  const curve: EnergyWindow[] = []
  let overallSumSq = 0
  let overallPeak = 0
  for (let w = 0; w < numWindows; w++) {
    const start = w * windowSamples
    const end = Math.min(data.length, start + windowSamples)
    let sumSq = 0
    let peak = 0
    let zeroCrossings = 0
    for (let i = start; i < end; i++) {
      const v = data[i]
      sumSq += v * v
      const abs = Math.abs(v)
      if (abs > peak) peak = abs
      if (i > start && (data[i - 1] >= 0) !== (v >= 0)) zeroCrossings++
    }
    const n = Math.max(1, end - start)
    curve.push({ timeSec: start / sr, rms: Math.sqrt(sumSq / n), peak, zcr: zeroCrossings / n })
    overallSumSq += sumSq
    if (peak > overallPeak) overallPeak = peak
  }
  const overallRms = Math.sqrt(overallSumSq / Math.max(1, data.length))
  const dynamicRangeDb = overallRms > 0 && overallPeak > 0 ? 20 * Math.log10(overallPeak / overallRms) : 0
  return { overallRms, overallPeak, dynamicRangeDb, curve }
}

/**
 * Estructura real (Fase 7 — DJ Engine), a partir de la curva de
 * energía ya calculada en Fase 6 (no se recalcula RMS de nuevo).
 *
 * Solo detecta lo que se puede medir de verdad sobre la energía real:
 * dónde termina un tramo inicial flojo (intro), dónde empieza uno
 * final flojo (outro), saltos bruscos de energía por encima del
 * promedio del propio track (candidatos a "drop"), y corridas de
 * ventanas flojas en el medio (candidatos a "break"/breakdown). Los
 * umbrales son relativos al propio track (su propio promedio de RMS),
 * no un valor fijo global inventado.
 *
 * NO detecta verso/estribillo/voz/instrumental — eso necesitaría
 * reconocimiento semántico real (matriz de auto-similitud sobre
 * timbre/armonía a lo largo del tiempo, o un modelo de detección de
 * voz) que no existe en este proyecto. Declarar esas etiquetas sin esa
 * capacidad real sería inventarlas (regla de realidad del prompt
 * maestro) — quedan fuera de esta fase, NOT_IMPLEMENTED.
 * (`StructureAnalysis` vive en `../types` por el mismo motivo que
 * `BeatGrid`/`KeyDetection`/`EnergyProfile`.)
 */
export function analyzeStructure(profile: EnergyProfile): StructureAnalysis {
  const { curve } = profile
  if (curve.length < 4) return { introEndSec: null, outroStartSec: null, dropCandidates: [], quietSections: [] }

  const rmsValues = curve.map((w) => w.rms)
  const avg = rmsValues.reduce((s, v) => s + v, 0) / rmsValues.length
  const quietThreshold = avg * 0.4

  let introEnd = 0
  while (introEnd < curve.length && rmsValues[introEnd] < quietThreshold) introEnd++
  const introEndSec = introEnd > 0 && introEnd < curve.length ? curve[introEnd].timeSec : null

  let outroStartIdx = curve.length
  while (outroStartIdx > 0 && rmsValues[outroStartIdx - 1] < quietThreshold) outroStartIdx--
  const outroStartSec = outroStartIdx < curve.length && outroStartIdx > introEnd ? curve[outroStartIdx].timeSec : null

  const dropCandidates: number[] = []
  for (let i = Math.max(1, introEnd); i < outroStartIdx; i++) {
    const delta = rmsValues[i] - rmsValues[i - 1]
    if (delta > avg * 0.8 && rmsValues[i] > avg * 1.3) dropCandidates.push(curve[i].timeSec)
  }

  const quietSections: { startSec: number; endSec: number }[] = []
  let runStart: number | null = null
  for (let i = introEnd; i < outroStartIdx; i++) {
    const isQuiet = rmsValues[i] < quietThreshold
    if (isQuiet && runStart == null) runStart = i
    if (!isQuiet && runStart != null) {
      if (i - runStart >= 2) quietSections.push({ startSec: curve[runStart].timeSec, endSec: curve[i].timeSec })
      runStart = null
    }
  }
  if (runStart != null && outroStartIdx - runStart >= 2) {
    quietSections.push({ startSec: curve[runStart].timeSec, endSec: curve[outroStartIdx]?.timeSec ?? curve[curve.length - 1].timeSec })
  }

  return { introEndSec, outroStartSec, dropCandidates, quietSections }
}

/**
 * RMS real de toda la pista (promedio de energía, no un pico
 * instantáneo) — usado por "Volumen automático inteligente" para
 * normalizar el TRIM de cada plato hacia un mismo nivel percibido, en
 * vez de que una pista grabada más floja o más fuerte que otra rompa
 * la mezcla.
 */
export function computeBufferRms(buffer: AudioBuffer): number {
  const data = buffer.getChannelData(0)
  let sum = 0
  for (let i = 0; i < data.length; i++) sum += data[i] * data[i]
  return Math.sqrt(sum / data.length)
}

/** Nivel de referencia al que "Volumen automático" intenta llevar cada pista — RMS típico de audio masterizado a volumen cómodo, ni al límite ni apagado. */
const SMART_VOLUME_TARGET_RMS = 0.18

function rms(analyser: AnalyserNode, buf: Uint8Array<ArrayBuffer>): number {
  analyser.getByteTimeDomainData(buf)
  let sum = 0
  for (let i = 0; i < buf.length; i++) {
    const v = (buf[i] - 128) / 128
    sum += v * v
  }
  return Math.sqrt(sum / buf.length)
}

const SPECTRUM_BARS = 28

/** Espectro real cuadro a cuadro (FFT real vía AnalyserNode, no una animación decorativa) — agrupa los bins de frecuencia en 28 barras normalizadas 0..1. */
function spectrumFrom(analyser: AnalyserNode, buf: Uint8Array<ArrayBuffer>): number[] {
  analyser.getByteFrequencyData(buf)
  const bars: number[] = []
  const perBar = Math.max(1, Math.floor(buf.length / SPECTRUM_BARS))
  for (let i = 0; i < SPECTRUM_BARS; i++) {
    const start = i * perBar
    let max = 0
    for (let j = start; j < start + perBar && j < buf.length; j++) if (buf[j] > max) max = buf[j]
    bars.push(max / 255)
  }
  return bars
}

function buildSmallImpulse(ctx: AudioContext): AudioBuffer {
  const rate = ctx.sampleRate
  const length = Math.floor(rate * 1.1)
  const impulse = ctx.createBuffer(2, length, rate)
  for (let ch = 0; ch < 2; ch++) {
    const data = impulse.getChannelData(ch)
    for (let i = 0; i < length; i++) data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / length, 2.2)
  }
  return impulse
}

function buildCrushCurve(): Float32Array {
  const steps = 10
  const curve = new Float32Array(1024)
  for (let i = 0; i < curve.length; i++) {
    const x = (i / (curve.length - 1)) * 2 - 1
    curve[i] = Math.round(x * steps) / steps
  }
  return curve
}

function buildNoiseBuffer(ctx: AudioContext): AudioBuffer {
  const length = ctx.sampleRate * 2
  const buffer = ctx.createBuffer(1, length, ctx.sampleRate)
  const data = buffer.getChannelData(0)
  for (let i = 0; i < length; i++) data[i] = Math.random() * 2 - 1
  return buffer
}

/**
 * Motor de un canal/deck completo: fuente de un solo uso (offset
 * manual), trim + EQ 3 bandas + Sound Color FX (filtro/dub echo/
 * noise/pitch/space/crush, real Web Audio) + fader + mute, tap/sync
 * de BPM, loop nativo, pitch real (playbackRate), 16 hot cues
 * paginados multi-modo (hotcue/sampler/keyboard/beatloop/pad fx
 * momentáneo) y VU real por análisis de señal. `cueBus` recibe el tap
 * de auriculares (PFL); `fxBus` recibe el tap para Beat FX cuando este
 * canal está seleccionado como fuente.
 */
export function useDeckEngine(ctx: AudioContext, output: AudioNode, cueBus: AudioNode, fxBus: AudioNode, storageKey: string, smartVolume = false) {
  const ls = useCallback((suffix: string) => `dj-ia:${storageKey}:${suffix}`, [storageKey])

  const [trackName, setTrackName] = useState<string | null>(null)
  const [isVideoTrack, setIsVideoTrack] = useState(false)
  const [thumbnail, setThumbnail] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [isPlaying, setIsPlaying] = useState(false)
  const [duration, setDuration] = useState(0)
  const [currentTime, setCurrentTime] = useState(0)
  const [peaks, setPeaks] = useState<number[] | null>(null)
  const [bpm, setBpm] = useState<number | null>(() => readLS(ls('bpm'), null))
  const [beatGrid, setBeatGrid] = useState<BeatGrid | null>(() => readLS(ls('beatGrid'), null))
  const [pitch, setPitchState] = useState(() => readLS(ls('pitch'), 0)) // -1..1 → ±PITCH_RANGE
  const [tempoRangePct, setTempoRangePct] = useState(() => readLS(ls('tempoRangePct'), 16))
  const [trim, setTrimState] = useState(() => readLS(ls('trim'), 1))
  const [eq, setEqState] = useState(() => readLS(ls('eq'), { low: 0, mid: 0, high: 0 }))
  const [colorFxType, setColorFxTypeState] = useState<ColorFxType>(() => readLS(ls('colorFxType'), 'filter'))
  const [colorFxAmount, setColorFxAmountState] = useState(() => readLS(ls('colorFxAmount'), 0))
  const [gainValue, setGainValue] = useState(() => readLS(ls('gain'), 0.85))
  const [muted, setMuted] = useState(false)
  const [cueOn, setCueOn] = useState(false)
  const [fxSendActive, setFxSendActiveState] = useState(false)
  const [loop, setLoop] = useState<LoopRegion>({ start: null, end: null, active: false })
  const [hotCues, setHotCues] = useState<HotCue[]>(Array.from({ length: HOTCUE_SLOTS }, () => ({ time: null })))
  const [page, setPage] = useState(0)
  const [level, setLevel] = useState(0)
  const [spectrum, setSpectrum] = useState<number[]>([])
  const freqBufRef = useRef<Uint8Array<ArrayBuffer> | null>(null)
  const [slip, setSlip] = useState(() => readLS(ls('slip'), false))
  const [quantize, setQuantize] = useState(() => readLS(ls('quantize'), true))

  const bufferRef = useRef<AudioBuffer | null>(null)
  const lastFileRef = useRef<File | null>(null)
  const sourceRef = useRef<AudioBufferSourceNode | MultiStemSource | null>(null)
  // Stems reales (voz/batería/bajo/resto) de la pista actual, separados
  // con IA bajo demanda — `null` hasta que se aprieta "STEMS" y termina.
  // Cambiar de pista los descarta (pertenecen a la pista anterior).
  const stemBuffersRef = useRef<StemBuffers | null>(null)
  const stemGainRefs = useRef<Record<StemName, GainNode> | null>(null)
  const [stemsReady, setStemsReady] = useState(false)
  const [isSeparatingStems, setIsSeparatingStems] = useState(false)
  const [stemProgress, setStemProgress] = useState<{ phase: string; ratio: number } | null>(null)
  const [stemMuted, setStemMuted] = useState<Record<StemName, boolean>>({ voz: false, bateria: false, bajo: false, resto: false })
  const startedAtRef = useRef(0)
  const offsetRef = useRef(0)
  const manualStopRef = useRef(false)
  // Fase 9 — SLIP real: reloj "fantasma" que sigue avanzando en tiempo
  // real desde el último punto sincronizado, INDEPENDIENTE de lo que
  // el audio audible esté haciendo (hot cue mantenido, loop activo).
  // No es una animación ni un booleano — es la misma aritmética de
  // tiempo real que usa `nowSeconds()` para la posición audible, pero
  // corriendo en paralelo sin que las intervenciones de performance lo
  // toquen. Al soltar/salir de la intervención, el audio real salta a
  // este valor en vez de quedarse donde la intervención lo dejó.
  const phantomOffsetRef = useRef(0)
  const phantomStartedAtRef = useRef(0)
  const phantomRunningRef = useRef(false)
  const rafRef = useRef<number | null>(null)
  const tapTimesRef = useRef<number[]>([])
  const tapLockedRef = useRef(false)
  const padFxPrevRef = useRef<{ type: ColorFxType; amount: number } | null>(null)

  const trimRef = useRef<GainNode | null>(null)
  const lowRef = useRef<BiquadFilterNode | null>(null)
  const midRef = useRef<BiquadFilterNode | null>(null)
  const highRef = useRef<BiquadFilterNode | null>(null)
  const colorFilterRef = useRef<BiquadFilterNode | null>(null)
  const dubEchoRef = useRef<{ delay: DelayNode; feedback: GainNode; wet: GainNode } | null>(null)
  const noiseWetRef = useRef<GainNode | null>(null)
  const pitchWetRef = useRef<GainNode | null>(null)
  const spaceWetRef = useRef<GainNode | null>(null)
  const crushWetRef = useRef<GainNode | null>(null)
  const colorPostRef = useRef<GainNode | null>(null)
  const fxSendRef = useRef<GainNode | null>(null)
  const faderRef = useRef<GainNode | null>(null)
  const muteRef = useRef<GainNode | null>(null)
  const cueSendRef = useRef<GainNode | null>(null)
  const analyserRef = useRef<AnalyserNode | null>(null)
  const vuBufRef = useRef<Uint8Array<ArrayBuffer> | null>(null)

  // Cadena: trim → EQ(low/mid/high) → color filter (serie, modo
  // "filter") + banco paralelo de wet (dub echo/noise/pitch/space/
  // crush, solo suena el tipo seleccionado) → colorPost → [fxSend →
  // fxBus] + [cueSend → cueBus] + fader → mute → VU → output
  useEffect(() => {
    const trimNode = ctx.createGain()
    trimNode.gain.value = trim
    const low = ctx.createBiquadFilter()
    low.type = 'lowshelf'
    low.frequency.value = EQ_LOW_HZ
    const mid = ctx.createBiquadFilter()
    mid.type = 'peaking'
    mid.frequency.value = 1000
    mid.Q.value = 0.9
    const high = ctx.createBiquadFilter()
    high.type = 'highshelf'
    high.frequency.value = EQ_HIGH_HZ

    const colorFilter = ctx.createBiquadFilter()
    colorFilter.type = 'lowpass'
    colorFilter.frequency.value = 20000

    const colorPost = ctx.createGain()

    const dubDelay = ctx.createDelay(1)
    dubDelay.delayTime.value = 0.38
    const dubFeedback = ctx.createGain()
    dubFeedback.gain.value = 0.5
    const dubWet = ctx.createGain()
    dubWet.gain.value = 0
    high.connect(dubDelay)
    dubDelay.connect(dubFeedback)
    dubFeedback.connect(dubDelay)
    dubDelay.connect(dubWet)
    dubWet.connect(colorPost)

    const noiseSource = ctx.createBufferSource()
    noiseSource.buffer = buildNoiseBuffer(ctx)
    noiseSource.loop = true
    const noiseWet = ctx.createGain()
    noiseWet.gain.value = 0
    noiseSource.connect(noiseWet)
    noiseWet.connect(colorPost)
    noiseSource.start()

    const pitchDelay = ctx.createDelay(0.05)
    pitchDelay.delayTime.value = 0.012
    const pitchLfo = ctx.createOscillator()
    pitchLfo.frequency.value = 5.5
    const pitchLfoGain = ctx.createGain()
    pitchLfoGain.gain.value = 0.006
    pitchLfo.connect(pitchLfoGain)
    pitchLfoGain.connect(pitchDelay.delayTime)
    pitchLfo.start()
    const pitchFeedback = ctx.createGain()
    pitchFeedback.gain.value = 0.2
    const pitchWet = ctx.createGain()
    pitchWet.gain.value = 0
    high.connect(pitchDelay)
    pitchDelay.connect(pitchFeedback)
    pitchFeedback.connect(pitchDelay)
    pitchDelay.connect(pitchWet)
    pitchWet.connect(colorPost)

    const convolver = ctx.createConvolver()
    convolver.buffer = buildSmallImpulse(ctx)
    const spaceWet = ctx.createGain()
    spaceWet.gain.value = 0
    high.connect(convolver)
    convolver.connect(spaceWet)
    spaceWet.connect(colorPost)

    const crusher = ctx.createWaveShaper()
    crusher.curve = buildCrushCurve() as Float32Array<ArrayBuffer>
    crusher.oversample = 'none'
    const crushWet = ctx.createGain()
    crushWet.gain.value = 0
    high.connect(crusher)
    crusher.connect(crushWet)
    crushWet.connect(colorPost)

    high.connect(colorFilter)
    colorFilter.connect(colorPost)

    const fxSend = ctx.createGain()
    fxSend.gain.value = 0
    colorPost.connect(fxSend)
    fxSend.connect(fxBus)

    const cueSend = ctx.createGain()
    cueSend.gain.value = 0
    colorPost.connect(cueSend)
    cueSend.connect(cueBus)

    const fader = ctx.createGain()
    fader.gain.value = gainValue
    const mute = ctx.createGain()
    mute.gain.value = 1
    const analyser = ctx.createAnalyser()
    analyser.fftSize = 256
    analyser.smoothingTimeConstant = 0.5

    trimNode.connect(low)
    low.connect(mid)
    mid.connect(high)
    colorPost.connect(fader)
    fader.connect(mute)
    mute.connect(analyser)
    analyser.connect(output)

    trimRef.current = trimNode
    lowRef.current = low
    midRef.current = mid
    highRef.current = high
    colorFilterRef.current = colorFilter
    dubEchoRef.current = { delay: dubDelay, feedback: dubFeedback, wet: dubWet }
    noiseWetRef.current = noiseWet
    pitchWetRef.current = pitchWet
    spaceWetRef.current = spaceWet
    crushWetRef.current = crushWet
    colorPostRef.current = colorPost
    fxSendRef.current = fxSend
    faderRef.current = fader
    muteRef.current = mute
    cueSendRef.current = cueSend
    analyserRef.current = analyser
    vuBufRef.current = new Uint8Array(analyser.fftSize)
    freqBufRef.current = new Uint8Array(analyser.frequencyBinCount)

    // Un `GainNode` persistente por stem (siempre conectado a `trimNode`,
    // igual entrada que usa hoy la fuente única) — así un mute/unmute de
    // stem cambia el audio al instante sin tocar la fuente que está
    // sonando, y el estado de mute sobrevive a un seek/loop/hot cue.
    const stemGains = STEM_NAMES.reduce((acc, stem) => {
      const g = ctx.createGain()
      g.gain.value = 1
      g.connect(trimNode)
      acc[stem] = g
      return acc
    }, {} as Record<StemName, GainNode>)
    stemGainRefs.current = stemGains

    // Aplica EQ y Sound Color FX ya guardados (si venían de una
    // sesión anterior) al grafo recién creado — si no, quedan solo
    // en el estado de React sin sonar hasta que el usuario los toque.
    low.gain.value = eq.low
    mid.gain.value = eq.mid
    high.gain.value = eq.high
    applyColorFx(colorFxType, colorFxAmount)

    return () => {
      pitchLfo.stop()
      noiseSource.stop()
      trimNode.disconnect(); low.disconnect(); mid.disconnect(); high.disconnect()
      colorFilter.disconnect(); colorPost.disconnect()
      dubDelay.disconnect(); dubFeedback.disconnect(); dubWet.disconnect()
      noiseWet.disconnect(); pitchDelay.disconnect(); pitchFeedback.disconnect(); pitchWet.disconnect()
      convolver.disconnect(); spaceWet.disconnect(); crusher.disconnect(); crushWet.disconnect()
      fxSend.disconnect(); cueSend.disconnect(); fader.disconnect(); mute.disconnect(); analyser.disconnect()
      STEM_NAMES.forEach((s) => stemGains[s].disconnect())
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ctx, output, cueBus, fxBus])

  const playbackRate = useCallback(() => 1 + pitch * (tempoRangePct / 100), [pitch, tempoRangePct])

  /** Posición real del reloj fantasma — misma fórmula que `nowSeconds()`, corrida en paralelo. */
  const phantomNowSeconds = useCallback(
    () => (phantomRunningRef.current
      ? phantomOffsetRef.current + (ctx.currentTime - phantomStartedAtRef.current) * playbackRate()
      : phantomOffsetRef.current),
    [ctx, playbackRate],
  )

  const syncPhantom = useCallback((atOffset: number, running: boolean) => {
    phantomOffsetRef.current = atOffset
    phantomStartedAtRef.current = ctx.currentTime
    phantomRunningRef.current = running
  }, [ctx])

  const stopSource = useCallback((preserveOffset: boolean) => {
    const source = sourceRef.current
    if (!source) return
    if (preserveOffset) {
      offsetRef.current += (ctx.currentTime - startedAtRef.current) * playbackRate()
      // Pausa real: el reloj fantasma también se congela — Slip no
      // tiene nada que "seguir avanzando" con el deck parado.
      syncPhantom(phantomNowSeconds(), false)
    }
    manualStopRef.current = true
    try { source.stop() } catch { /* ya estaba detenido */ }
    sourceRef.current = null
  }, [playbackRate, syncPhantom, phantomNowSeconds])

  const startSource = useCallback((fromOffset: number, opts?: { syncPhantom?: boolean }) => {
    if (!bufferRef.current || !trimRef.current) return
    const stems = stemBuffersRef.current
    const source: AudioBufferSourceNode | MultiStemSource = stems && stemGainRefs.current
      ? new MultiStemSource(ctx, stems, stemGainRefs.current)
      : ctx.createBufferSource()
    if (!(source instanceof MultiStemSource)) {
      source.buffer = bufferRef.current
      source.connect(trimRef.current)
    }
    source.playbackRate.value = playbackRate()
    if (loop.active && loop.start != null && loop.end != null && loop.end > loop.start) {
      source.loop = true
      source.loopStart = loop.start
      source.loopEnd = loop.end
    }
    source.onended = () => {
      if (manualStopRef.current) { manualStopRef.current = false; return }
      setIsPlaying(false)
      offsetRef.current = 0
      setCurrentTime(0)
    }
    source.start(0, fromOffset)
    sourceRef.current = source
    startedAtRef.current = ctx.currentTime
    offsetRef.current = fromOffset
    // Por default, arrancar una fuente resincroniza el reloj fantasma a
    // la misma posición (arranque/seek normal, sin Slip de por medio).
    // Las intervenciones de Slip pasan `syncPhantom: false` a propósito
    // para que el fantasma siga corriendo solo mientras dura el hold.
    if (opts?.syncPhantom !== false) syncPhantom(fromOffset, true)
  }, [ctx, loop, playbackRate, syncPhantom])

  const applyBuffer = useCallback((decoded: AudioBuffer, name: string, knownBpm?: number, knownBeatGrid?: BeatGrid, knownHotCues?: HotCue[] | null) => {
    bufferRef.current = decoded
    setDuration(decoded.duration)
    setPeaks(computePeaks(decoded))
    setTrackName(name)
    setLoop({ start: null, end: null, active: false })
    // `knownHotCues`: mismo criterio que BPM/Beat Grid (Fase 12) — si el
    // track viene de la Music Library con Hot Cues reales persistidos por
    // identidad de track, se restauran en vez de wipearlos.
    setHotCues(knownHotCues ?? Array.from({ length: HOTCUE_SLOTS }, () => ({ time: null })))
    setBpm(knownBpm ?? detectBpm(decoded))
    // `knownBeatGrid`: mismo criterio que BPM (Fase 2/4) — no
    // recalcular el grid de beats si ya viene real y persistido.
    setBeatGrid(knownBeatGrid ?? detectBeatGrid(decoded))
    tapTimesRef.current = []
    tapLockedRef.current = false
    // Volumen automático inteligente: RMS real de la pista completa
    // contra un nivel de referencia — clamp para no exagerar en
    // pistas grabadas muy flojas o muy fuertes.
    if (smartVolume) {
      const level = computeBufferRms(decoded)
      const factor = Math.min(2.5, Math.max(0.4, level > 0.001 ? SMART_VOLUME_TARGET_RMS / level : 1))
      setTrimState(factor)
      if (trimRef.current) trimRef.current.gain.value = factor
    }
  }, [smartVolume])

  const loadFile = useCallback((file: File, opts?: { persist?: boolean; onLoaded?: () => void; knownBpm?: number; knownBeatGrid?: BeatGrid; knownHotCues?: HotCue[] | null }) => {
    setIsLoading(true)
    stopSource(false)
    offsetRef.current = 0
    setCurrentTime(0)
    setIsPlaying(false)
    // Los stems separados son de la pista anterior — una pista nueva
    // arranca sin stems hasta que se aprieta "STEMS" de nuevo.
    stemBuffersRef.current = null
    setStemsReady(false)
    setStemMuted({ voz: false, bateria: false, bajo: false, resto: false })
    lastFileRef.current = file
    const fileIsVideo = file.type.startsWith('video/')
    setIsVideoTrack(fileIsVideo)
    setThumbnail(null)
    // El video se descarta apenas se saca el fotograma — la mezcla real
    // (EQ, loop, hot cues, BPM, pitch) sigue siendo 100% el audio
    // decodificado abajo, igual que un archivo de audio común.
    if (fileIsVideo) void captureVideoThumbnail(file).then(setThumbnail)
    if (opts?.persist !== false) void saveTrack(ls('track'), file)
    file.arrayBuffer()
      .then((data) => ctx.decodeAudioData(data))
      // `knownBpm`: si el track ya viene de la Smart Music Library con
      // BPM real persistido, se reutiliza en vez de correr `detectBpm`
      // de nuevo (Fase 2, regla: "evitar recalcular BPM innecesariamente").
      .then((decoded) => { applyBuffer(decoded, file.name.replace(/\.[^./]+$/, ''), opts?.knownBpm, opts?.knownBeatGrid, opts?.knownHotCues); opts?.onLoaded?.() })
      .catch(() => setTrackName(null))
      .finally(() => setIsLoading(false))
  }, [ctx, stopSource, applyBuffer, ls])

  const loadTrack = useCallback((track: Track) => {
    stopSource(false)
    offsetRef.current = 0
    setCurrentTime(0)
    setIsPlaying(false)
    setIsVideoTrack(false)
    setThumbnail(null)
    stemBuffersRef.current = null
    setStemsReady(false)
    setStemMuted({ voz: false, bateria: false, bajo: false, resto: false })
    lastFileRef.current = null
    applyBuffer(track.buffer, track.name, track.bpm)
  }, [stopSource, applyBuffer])

  // Saca la pista del plato del todo — vuelve a "Sin pista", distinto
  // de cargar una nueva encima (`loadFile`/`loadTrack`).
  const unloadTrack = useCallback(() => {
    stopSource(false)
    bufferRef.current = null
    lastFileRef.current = null
    offsetRef.current = 0
    setCurrentTime(0)
    setIsPlaying(false)
    setTrackName(null)
    setIsVideoTrack(false)
    setThumbnail(null)
    setDuration(0)
    setPeaks(null)
    setBpm(null)
    setBeatGrid(null)
    setHotCues(Array.from({ length: HOTCUE_SLOTS }, () => ({ time: null })))
    setLoop({ start: null, end: null, active: false })
    stemBuffersRef.current = null
    setStemsReady(false)
    setStemMuted({ voz: false, bateria: false, bajo: false, resto: false })
  }, [stopSource])

  const seekTo = useCallback((seconds: number) => {
    const buffer = bufferRef.current
    if (!buffer) return
    const clamped = Math.min(Math.max(seconds, 0), buffer.duration)
    if (isPlaying) { stopSource(false); startSource(clamped) } else { offsetRef.current = clamped }
    setCurrentTime(clamped)
  }, [isPlaying, startSource, stopSource])

  const togglePlay = useCallback(() => {
    const buffer = bufferRef.current
    if (!buffer) return
    if (ctx.state === 'suspended') void ctx.resume()
    if (isPlaying) {
      stopSource(true)
      setIsPlaying(false)
    } else {
      const from = offsetRef.current >= buffer.duration ? 0 : offsetRef.current
      startSource(from)
      setIsPlaying(true)
    }
  }, [ctx, isPlaying, startSource, stopSource])

  const cuePress = useCallback(() => {
    const buffer = bufferRef.current
    if (!buffer) return
    const cueTime = hotCues[0].time ?? 0
    seekTo(cueTime)
    if (!isPlaying) togglePlay()
  }, [hotCues, isPlaying, seekTo, togglePlay])

  const nudge = useCallback((deltaSeconds: number) => {
    const now = isPlaying ? offsetRef.current + (ctx.currentTime - startedAtRef.current) * playbackRate() : offsetRef.current
    seekTo(now + deltaSeconds)
  }, [ctx, isPlaying, playbackRate, seekTo])

  const nowSeconds = useCallback(
    () => (isPlaying ? offsetRef.current + (ctx.currentTime - startedAtRef.current) * playbackRate() : offsetRef.current),
    [ctx, isPlaying, playbackRate],
  )

  // Fase 4 — conecta el toggle "Quantize" (ya existía en CONFIG, no
  // tenía efecto real) al grid de beats real: con quantize activado,
  // marcar un hot cue o un loop redondea al beat más cercano en vez de
  // quedar en el milisegundo exacto donde se tocó el botón.
  const quantizedNow = useCallback(
    () => (quantize ? nearestBeatTime(nowSeconds(), beatGrid) : nowSeconds()),
    [quantize, nowSeconds, beatGrid],
  )

  // --- Mezcla ---
  const setGain = useCallback((v: number) => { setGainValue(v); if (faderRef.current) faderRef.current.gain.value = v }, [])
  const setTrim = useCallback((v: number) => { setTrimState(v); if (trimRef.current) trimRef.current.gain.value = v }, [])
  const setEq = useCallback((band: EqBand, valueDb: number) => {
    setEqState((prev) => ({ ...prev, [band]: valueDb }))
    const node = band === 'low' ? lowRef.current : band === 'mid' ? midRef.current : highRef.current
    if (node) node.gain.value = valueDb
  }, [])

  const applyColorFx = useCallback((type: ColorFxType, amount: number) => {
    const wet = Math.min(1, Math.abs(amount))
    const filter = colorFilterRef.current
    if (filter) {
      if (type === 'filter') {
        if (amount >= 0) { filter.type = 'lowpass'; filter.frequency.value = 20000 * Math.pow(2, -amount * 8) }
        else { filter.type = 'highpass'; filter.frequency.value = 20 * Math.pow(2, -amount * 8) }
      } else {
        filter.type = 'lowpass'
        filter.frequency.value = 20000
      }
    }
    if (dubEchoRef.current) dubEchoRef.current.wet.gain.value = type === 'dubecho' ? wet * 0.9 : 0
    if (noiseWetRef.current) noiseWetRef.current.gain.value = type === 'noise' ? wet * 0.5 : 0
    if (pitchWetRef.current) pitchWetRef.current.gain.value = type === 'pitch' ? wet : 0
    if (spaceWetRef.current) spaceWetRef.current.gain.value = type === 'space' ? wet * 0.8 : 0
    if (crushWetRef.current) crushWetRef.current.gain.value = type === 'crush' ? wet * 0.7 : 0
  }, [])

  const setColorFxType = useCallback((type: ColorFxType) => { setColorFxTypeState(type); applyColorFx(type, colorFxAmount) }, [applyColorFx, colorFxAmount])
  const setColorFxAmount = useCallback((amount: number) => { setColorFxAmountState(amount); applyColorFx(colorFxType, amount) }, [applyColorFx, colorFxType])

  const toggleMuted = useCallback(() => {
    setMuted((prev) => { const next = !prev; if (muteRef.current) muteRef.current.gain.value = next ? 0 : 1; return next })
  }, [])
  const toggleCue = useCallback(() => {
    setCueOn((prev) => { const next = !prev; if (cueSendRef.current) cueSendRef.current.gain.value = next ? 1 : 0; return next })
  }, [])
  const setFxSendActive = useCallback((active: boolean) => {
    setFxSendActiveState(active)
    if (fxSendRef.current) fxSendRef.current.gain.value = active ? 1 : 0
  }, [])

  // --- Pitch / BPM / Sync ---
  const setPitch = useCallback((v: number) => {
    setPitchState(v)
    if (sourceRef.current) {
      offsetRef.current = nowSeconds()
      startedAtRef.current = ctx.currentTime
      sourceRef.current.playbackRate.value = 1 + v * (tempoRangePct / 100)
    }
  }, [ctx, nowSeconds, tempoRangePct])

  const resetTempo = useCallback(() => setPitch(0), [setPitch])
  const cycleTempoRange = useCallback(() => setTempoRangePct((prev) => (prev === 16 ? 8 : prev === 8 ? 6 : 16)), [])

  const tapTempo = useCallback(() => {
    const now = performance.now()
    // Un toque suelto (más de 2s desde el anterior) arranca una
    // secuencia nueva — así se puede volver a tapear un tempo
    // distinto sin quedar pegado al anterior.
    if (tapTimesRef.current.length && now - tapTimesRef.current[tapTimesRef.current.length - 1] > 2000) {
      tapTimesRef.current = []
      tapLockedRef.current = false
    }
    if (tapLockedRef.current) return // ya encontró el tempo correcto, no se mueve más
    const taps = [...tapTimesRef.current, now]
    tapTimesRef.current = taps
    if (taps.length < 2) {
      // Un solo toque todavía no alcanza para calcular un tempo real
      // (hace falta el intervalo entre dos) — pero se pedía
      // explícitamente que el BPM aparezca ya al primer toque, así
      // que se muestra un valor de partida (120, el más común) que
      // el segundo toque en adelante corrige al tempo real.
      setBpm((prev) => prev ?? 120)
      return
    }
    const intervals = taps.slice(1).map((t, i) => t - taps[i])
    const avgMs = intervals.reduce((a, b) => a + b, 0) / intervals.length
    setBpm(Math.round(60000 / avgMs))
    // Últimos 3 intervalos parecidos entre sí (menos de 4% de
    // diferencia) = encontró el ritmo de verdad, se queda ahí quieto
    // en vez de seguir subiendo/bajando con cada toque de más.
    if (intervals.length >= 3) {
      const last3 = intervals.slice(-3)
      const avg3 = last3.reduce((a, b) => a + b, 0) / 3
      const steady = last3.every((v) => Math.abs(v - avg3) / avg3 < 0.04)
      if (steady) tapLockedRef.current = true
    }
  }, [])

  /**
   * BEAT SYNC real (Fase 10 — DJ Engine). Antes solo igualaba el
   * BPM (pitch/tempo) del otro plato — real en cuanto a que sí movía
   * el `playbackRate` de verdad, pero nunca alineaba en qué punto del
   * compás está cada uno (dos platos al mismo BPM pueden sonar
   * completamente descuadrados si sus beats no caen juntos). Ahora,
   * cuando llega el Beat Grid real del otro plato (`targetGrid`) y su
   * posición real (`targetNow`), además de igualar el tempo se calcula
   * el corrimiento mínimo real (en tiempo de buffer, independiente del
   * playbackRate de cualquiera de los dos) para que la FASE del beat
   * también quede alineada, y se aplica con el mismo `seekTo` real que
   * ya usa cualquier salto de posición — coherente con SLIP (Fase 9):
   * si el plato tiene Slip activo, ese mismo `seekTo` ya resincroniza
   * el reloj fantasma solo, sin lógica especial acá.
   */
  const syncTo = useCallback((targetBpm: number, targetGrid?: BeatGrid | null, targetNow?: number) => {
    const own = bpm ?? DEFAULT_BPM
    const ratio = Math.min(2, Math.max(0.5, targetBpm / own))
    const nextPitch = Math.min(1, Math.max(-1, (ratio - 1) / (tempoRangePct / 100)))
    setPitch(nextPitch)

    if (beatGrid && targetGrid && targetNow != null) {
      const ownNow = nowSeconds()
      const wrap01 = (x: number) => ((x % 1) + 1) % 1
      const ownPhase = wrap01((ownNow - beatGrid.firstBeatSec) / beatGrid.periodSec)
      const targetPhase = wrap01((targetNow - targetGrid.firstBeatSec) / targetGrid.periodSec)
      let phaseDiff = targetPhase - ownPhase
      if (phaseDiff > 0.5) phaseDiff -= 1
      if (phaseDiff < -0.5) phaseDiff += 1
      seekTo(ownNow + phaseDiff * beatGrid.periodSec)
    }
    // `setPitch` es estado de React — recién se aplica al próximo
    // render, pero la fuente ya está sonando (o `seekTo` de arriba
    // acaba de arrancar una nueva) YA, en esta misma sincrónica. Se
    // fuerza el rate real correcto directo sobre el nodo de audio
    // ahora mismo, mismo criterio que ya se usó para el loop real de
    // Slip (Fase 9) — sin esto, el primer `.start()` post-Sync salía
    // con el rate viejo (closure de `playbackRate()` no actualizado).
    if (sourceRef.current) sourceRef.current.playbackRate.value = 1 + nextPitch * (tempoRangePct / 100)
  }, [bpm, setPitch, tempoRangePct, beatGrid, nowSeconds, seekTo])

  // --- Loop ---
  const applyLoopToSource = useCallback((region: LoopRegion) => {
    const source = sourceRef.current
    if (!source) return
    if (region.active && region.start != null && region.end != null && region.end > region.start) {
      source.loop = true; source.loopStart = region.start; source.loopEnd = region.end
    } else source.loop = false
  }, [])

  const setLoopIn = useCallback(() => {
    // `applyLoopToSource` corre afuera del updater de `setLoop` — mismo
    // motivo que `exitReloop`: React 18 no garantiza que el updater
    // corra en esta sincrónica, y esto toca el nodo de audio real ya.
    const next = { ...loop, start: quantizedNow() }
    applyLoopToSource(next)
    setLoop(next)
  }, [loop, quantizedNow, applyLoopToSource])
  // OUT deja el loop armado pero SIN activar todavía — quien lo
  // enciende de verdad es el botón ACTIVE (antes se activaba solo al
  // marcar OUT, y como resultado tocar ACTIVE lo primero que hacía
  // era APAGARLO, lo cual se sentía como que el botón "no funciona").
  const setLoopOut = useCallback(() => {
    const end = quantizedNow()
    if (loop.start == null || end <= loop.start) return
    const next = { start: loop.start, end, active: false }
    applyLoopToSource(next)
    setLoop(next)
  }, [loop, quantizedNow, applyLoopToSource])
  const exitReloop = useCallback(() => {
    // `applyLoopToSource` toca el nodo de audio real YA — no puede
    // quedar adentro del updater de `setLoop` (React 18 no garantiza
    // correrlo en esta misma sincrónica, así que el nodo podía quedar
    // loopeando de más). Se lee `loop` del closure directo y se aplica
    // el efecto real ANTES de avisarle a React del nuevo estado.
    const turningOff = loop.active
    const next = { ...loop, active: !loop.active }
    if (slip && turningOff && isPlaying) {
      // SLIP real: salir de un loop no te deja donde el loop te dejó
      // — te devuelve a donde la pista habría estado si el loop
      // nunca se hubiera activado (el reloj fantasma, que siguió
      // corriendo solo todo este tiempo). Se arranca una fuente
      // nueva ahí y se le fuerza el loop apagado, sin depender de
      // que el closure de `startSource` ya tenga `loop.active`
      // actualizado (React todavía no re-renderizó en este punto).
      const target = phantomNowSeconds()
      stopSource(false)
      startSource(target)
      applyLoopToSource(next)
    } else {
      applyLoopToSource(next)
    }
    setLoop(next)
  }, [loop, applyLoopToSource, slip, isPlaying, phantomNowSeconds, stopSource, startSource])

  // Vacía el loop del todo (IN/OUT/ACTIVE quedan sin marcar) — distinto
  // de `exitReloop`, que solo prende/apaga un loop que ya quedó armado.
  const clearLoop = useCallback(() => {
    const next: LoopRegion = { start: null, end: null, active: false }
    applyLoopToSource(next)
    setLoop(next)
  }, [applyLoopToSource])

  const setAutoLoop = useCallback((beats: number) => {
    const beatSeconds = 60 / (bpm ?? DEFAULT_BPM)
    const start = quantizedNow()
    const next: LoopRegion = { start, end: start + beatSeconds * beats, active: true }
    setLoop(next)
    applyLoopToSource(next)
  }, [bpm, quantizedNow, applyLoopToSource])
  const loop4Beats = useCallback(() => setAutoLoop(4), [setAutoLoop])

  const beatJump = useCallback((beats: number) => {
    const beatSeconds = 60 / (bpm ?? DEFAULT_BPM)
    nudge(beatSeconds * beats)
  }, [bpm, nudge])

  // --- Pads ---
  const togglePage = useCallback(() => setPage((p) => (p === 0 ? 1 : 0)), [])

  const oneShotFrom = useCallback((time: number, rate: number) => {
    const buffer = bufferRef.current
    const fader = faderRef.current
    if (!buffer || !fader) return
    const oneShot = ctx.createBufferSource()
    oneShot.buffer = buffer
    oneShot.playbackRate.value = rate
    const oneShotGain = ctx.createGain()
    oneShotGain.gain.value = 0.9
    oneShot.connect(oneShotGain)
    oneShotGain.connect(fader)
    oneShot.start(0, time)
    oneShot.onended = () => oneShotGain.disconnect()
  }, [ctx])

  // SLIP real de Hot Cue: `true` mientras el pad sigue apretado y la
  // intervención está activa — `releasePad` lo usa para saber si de
  // verdad hay que devolver la pista al reloj fantasma al soltar (no
  // todo pointerUp corresponde a un hold real de Slip).
  const slipHoldActiveRef = useRef(false)
  /** LOOP ROLL real (Fase 11): `true` mientras un pad en modo Beat Loop sigue apretado — `releasePad` lo usa para saber si soltar debe devolver la pista al reloj fantasma. */
  const loopRollActiveRef = useRef(false)

  const triggerPad = useCallback((index: number, mode: PadMode, opts?: { shift?: boolean }) => {
    const slot = page * 8 + index
    if (mode === 'hotcue') {
      setHotCues((prev) => {
        const cue = prev[slot]
        if (opts?.shift && cue.time != null) return prev.map((c, i) => (i === slot ? { time: null } : c))
        if (cue.time == null) {
          const time = quantizedNow()
          return prev.map((c, i) => (i === slot ? { time } : c))
        }
        if (slip && isPlaying) {
          // SLIP real: el press salta el audio al cue, pero el reloj
          // fantasma sigue corriendo solo (no se resincroniza) — al
          // soltar (`releasePad`), la pista vuelve ahí, no se queda en
          // el cue.
          slipHoldActiveRef.current = true
          stopSource(false)
          startSource(cue.time, { syncPhantom: false })
        } else {
          seekTo(cue.time)
          if (!isPlaying) togglePlay()
        }
        return prev
      })
      return
    }
    if (mode === 'beatloop') {
      // LOOP ROLL real (Fase 11): mantener presionado el pad mantiene
      // el loop sonando (reutiliza `setAutoLoop`, ya real); al soltar
      // (`releasePad`) vuelve de verdad a la posición del reloj
      // fantasma — SIEMPRE, sea que el toggle global de Slip esté
      // prendido o no (a diferencia del loop manual IN/OUT/ACTIVE, que
      // sigue dependiendo de ese toggle): Loop Roll es en sí mismo un
      // efecto momentáneo de auto-retorno, no un loop persistente.
      loopRollActiveRef.current = true
      setAutoLoop(LOOP_LENGTHS[index])
      return
    }
    if (mode === 'beatjump') {
      const isBack = index < 4
      const size = Math.pow(2, index % 4)
      beatJump((isBack ? -1 : 1) * size)
      return
    }
    if (mode === 'keyboard') { oneShotFrom(nowSeconds(), playbackRate() * Math.pow(2, KEYBOARD_SEMITONES[index] / 12)); return }
    if (mode === 'sampler') { oneShotFrom(hotCues[slot].time ?? 0, playbackRate()); return }
  }, [page, nowSeconds, quantizedNow, seekTo, isPlaying, togglePlay, setAutoLoop, beatJump, oneShotFrom, playbackRate, hotCues, slip, stopSource, startSource])

  /**
   * Soltar un pad — dos casos reales:
   * - Hot Cue con SLIP activo y un hold real en curso (Fase 9, ver `triggerPad`).
   * - LOOP ROLL (Fase 11): soltar un pad de Beat Loop siempre devuelve
   *   la pista al reloj fantasma real y apaga el loop — sea que el
   *   toggle global de Slip esté prendido o no, porque Loop Roll es en
   *   sí mismo un efecto momentáneo (a diferencia del loop manual
   *   IN/OUT/ACTIVE, que sigue respetando ese toggle).
   */
  const releasePad = useCallback((mode: PadMode) => {
    if (mode === 'hotcue' && slipHoldActiveRef.current) {
      slipHoldActiveRef.current = false
      const target = phantomNowSeconds()
      stopSource(false)
      startSource(target)
      return
    }
    if (mode === 'beatloop' && loopRollActiveRef.current) {
      loopRollActiveRef.current = false
      if (isPlaying) {
        const target = phantomNowSeconds()
        stopSource(false)
        startSource(target)
      }
      // `applyLoopToSource` afuera del updater de `setLoop` — mismo
      // motivo que `exitReloop`/`setLoopIn`/`setLoopOut`: toca el nodo
      // de audio real ya, no puede esperar a que React decida correr
      // el updater.
      const next = { ...loop, active: false }
      applyLoopToSource(next)
      setLoop(next)
    }
  }, [phantomNowSeconds, stopSource, startSource, isPlaying, applyLoopToSource, loop])

  const padFxDown = useCallback((index: number) => {
    padFxPrevRef.current = { type: colorFxType, amount: colorFxAmount }
    const preset = PAD_FX_PRESETS[index % PAD_FX_PRESETS.length]
    applyColorFx(preset.type, preset.amount)
  }, [applyColorFx, colorFxType, colorFxAmount])

  const padFxUp = useCallback(() => {
    const prev = padFxPrevRef.current
    if (prev) applyColorFx(prev.type, prev.amount)
    padFxPrevRef.current = null
  }, [applyColorFx])

  const clearHotCues = useCallback(
    () => setHotCues(Array.from({ length: HOTCUE_SLOTS }, () => ({ time: null }))),
    [],
  )

  // Loop de UI: currentTime + VU + espectro real cuadro a cuadro solo mientras suena
  useEffect(() => {
    if (!isPlaying) { setLevel(0); setSpectrum([]); return }
    const tick = () => {
      setCurrentTime(nowSeconds())
      const analyser = analyserRef.current
      const buf = vuBufRef.current
      if (analyser && buf) setLevel(rms(analyser, buf))
      const freqBuf = freqBufRef.current
      if (analyser && freqBuf) setSpectrum(spectrumFrom(analyser, freqBuf))
      rafRef.current = requestAnimationFrame(tick)
    }
    rafRef.current = requestAnimationFrame(tick)
    return () => { if (rafRef.current != null) cancelAnimationFrame(rafRef.current) }
  }, [isPlaying, nowSeconds])

  // Bug real encontrado en Fase 11: este efecto quería decir "al
  // desmontar el deck, cortar el audio" — pero `[stopSource]` como
  // dependencia lo disparaba cada vez que `stopSource` cambiaba de
  // referencia, y `stopSource` depende de `playbackRate`, que depende
  // de `pitch`. Resultado real: CUALQUIER cambio de pitch/tempo (por
  // ejemplo, un SYNC real, Fase 10) mataba en silencio la reproducción
  // segundos después, sin volver a arrancarla — invisible en un
  // chequeo rápido porque el arranque en sí (rate/offset) ya había
  // quedado bien registrado antes de que este efecto la cortara. Se
  // usa un ref con la versión más nueva de `stopSource` y un efecto
  // de dependencias VACÍAS — así la limpieza corre solo al desmontar
  // de verdad, nunca por un cambio de pitch.
  const stopSourceRef = useRef(stopSource)
  useEffect(() => { stopSourceRef.current = stopSource }, [stopSource])
  useEffect(() => () => stopSourceRef.current(false), [])

  // Recuperar la pista real al entrar (IndexedDB) — no hace autoplay
  // (el navegador lo bloquea sin un gesto del usuario), deja todo
  // cargado y listo para tocar Play. Los hot cues y el loop guardados
  // se aplican recién cuando termina de decodificar, porque
  // applyBuffer los resetea al cargar cualquier archivo nuevo.
  useEffect(() => {
    let cancelled = false
    loadTrackFromDb(ls('track')).then((file) => {
      if (!file || cancelled) return
      // BPM/beat grid ya persistidos de la carga anterior — se reusan
      // acá para no re-analizar el audio en cada refresh (Fase 2/4).
      const savedBpm = readLS<number | null>(ls('bpm'), null)
      const savedBeatGrid = readLS<BeatGrid | null>(ls('beatGrid'), null)
      loadFile(file, {
        persist: false,
        knownBpm: savedBpm ?? undefined,
        knownBeatGrid: savedBeatGrid ?? undefined,
        onLoaded: () => {
          if (cancelled) return
          const savedHotCues = readLS<HotCue[] | null>(ls('hotCues'), null)
          if (savedHotCues) setHotCues(savedHotCues)
          const savedLoop = readLS<LoopRegion | null>(ls('loop'), null)
          if (savedLoop) setLoop(savedLoop)
        },
      })
    })
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => writeLS(ls('pitch'), pitch), [pitch, ls])
  useEffect(() => writeLS(ls('tempoRangePct'), tempoRangePct), [tempoRangePct, ls])
  useEffect(() => writeLS(ls('trim'), trim), [trim, ls])
  useEffect(() => writeLS(ls('eq'), eq), [eq, ls])
  useEffect(() => writeLS(ls('colorFxType'), colorFxType), [colorFxType, ls])
  useEffect(() => writeLS(ls('colorFxAmount'), colorFxAmount), [colorFxAmount, ls])
  useEffect(() => writeLS(ls('gain'), gainValue), [gainValue, ls])
  useEffect(() => writeLS(ls('slip'), slip), [slip, ls])
  useEffect(() => writeLS(ls('quantize'), quantize), [quantize, ls])
  useEffect(() => writeLS(ls('bpm'), bpm), [bpm, ls])
  useEffect(() => writeLS(ls('beatGrid'), beatGrid), [beatGrid, ls])
  useEffect(() => writeLS(ls('hotCues'), hotCues), [hotCues, ls])
  useEffect(() => writeLS(ls('loop'), loop), [loop, ls])

  const getLoadedFile = useCallback(() => lastFileRef.current, [])

  const separateStemsNow = useCallback(async () => {
    const file = lastFileRef.current
    if (!file || isSeparatingStems) return
    setIsSeparatingStems(true)
    setStemProgress(null)
    try {
      const stems = await runStemSeparation(file, ctx, (evt) => setStemProgress(evt))
      stemBuffersRef.current = stems
      setStemsReady(true)
      setStemMuted({ voz: false, bateria: false, bajo: false, resto: false })
      // Si ya estaba sonando con la mezcla completa, pasa a los 4 stems
      // sin cortar el audio — para en la misma posición y arranca de
      // nuevo ahí mismo, ahora con los stems reales.
      if (isPlaying) { stopSource(true); startSource(offsetRef.current) }
    } catch (err) {
      console.error('[DJ IA] separación de stems falló:', err)
    } finally {
      setIsSeparatingStems(false)
      setStemProgress(null)
    }
  }, [ctx, isPlaying, isSeparatingStems, startSource, stopSource])

  const setStemMute = useCallback((stem: StemName, mutedVal: boolean) => {
    const gain = stemGainRefs.current?.[stem]
    if (gain) gain.gain.value = mutedVal ? 0 : 1
    setStemMuted((prev) => ({ ...prev, [stem]: mutedVal }))
  }, [])

  return {
    trackName, isVideoTrack, thumbnail, isLoading, isPlaying, duration, currentTime, peaks, bpm, beatGrid, level, spectrum,
    getLoadedFile,
    pitch, tempoRangePct, trim, eq, colorFxType, colorFxAmount, gain: gainValue, muted, cueOn, fxSendActive,
    loop, hotCues, page, slip, quantize,
    loadFile, loadTrack, unloadTrack, togglePlay, cuePress, seekTo, nudge,
    setGain, setTrim, setEq, setColorFxType, setColorFxAmount, toggleMuted, toggleCue, setFxSendActive,
    setPitch, resetTempo, cycleTempoRange, tapTempo, syncTo,
    setLoopIn, setLoopOut, exitReloop, clearLoop, setAutoLoop, loop4Beats, beatJump,
    triggerPad, releasePad, padFxDown, padFxUp, clearHotCues, togglePage,
    setSlip, setQuantize,
    stemsReady, isSeparatingStems, stemProgress, stemMuted,
    separateStemsNow, setStemMute,
  }
}

export type DeckEngine = ReturnType<typeof useDeckEngine>
