export type EqBand = 'low' | 'mid' | 'high'

export type PadMode = 'hotcue' | 'padfx' | 'beatjump' | 'sampler' | 'keyboard' | 'beatloop'

export const PAD_MODES: { key: PadMode; label: string; color: string }[] = [
  { key: 'hotcue', label: 'Hot Cue', color: '#4ade80' },
  { key: 'padfx', label: 'Pad FX', color: '#f472b6' },
  { key: 'beatjump', label: 'Beat Jump', color: '#38bdf8' },
  { key: 'sampler', label: 'Sampler', color: '#facc15' },
  { key: 'keyboard', label: 'Keyboard', color: '#a78bfa' },
  { key: 'beatloop', label: 'Beat Loop', color: '#fb923c' },
]

export type ColorFxType = 'filter' | 'dubecho' | 'noise' | 'pitch' | 'space' | 'crush'

export const COLOR_FX_TYPES: ColorFxType[] = ['filter', 'dubecho', 'noise', 'pitch', 'space', 'crush']

export type BeatFxType = 'delay' | 'echo' | 'reverb' | 'flanger' | 'phaser' | 'pitch' | 'roll' | 'spiral' | 'trans' | 'enigma' | 'mobius'

export const BEAT_FX_TYPES: BeatFxType[] = ['delay', 'echo', 'reverb', 'flanger', 'phaser', 'pitch', 'roll', 'spiral', 'trans', 'enigma', 'mobius']

export const BEAT_FX_BEATS = [1 / 4, 1 / 2, 3 / 4, 1, 2, 4, 8, 16] as const

export const LOOP_LENGTHS = [1 / 4, 1 / 2, 1, 2, 4, 8, 16, 32] as const

export const BEATJUMP_SIZES = [1, 2, 4, 8] as const

export const KEYBOARD_SEMITONES = [-3, -1, 0, 2, 4, 5, 7, 9] as const

export const HOTCUE_PAGES = 2
export const HOTCUE_SLOTS = 8 * HOTCUE_PAGES

export interface LoopRegion {
  start: number | null
  end: number | null
  active: boolean
}

export interface HotCue {
  time: number | null
}

export interface Track {
  id: string
  name: string
  bpm: number
  key: string
  buffer: AudioBuffer
}

/**
 * Grid de beats real (Fase 4 — DJ Engine). Definido acá (no en
 * `useDeckEngine.ts`) para que tanto el motor del deck como
 * `musicLibraryRepository.ts` lo compartan sin import circular.
 */
export interface BeatGrid {
  /** Segundo real del primer beat detectado (fase del grid). */
  firstBeatSec: number
  /** 60 / bpm — período real entre beats consecutivos. */
  periodSec: number
}

export type DeckSlot = 1 | 2 | 3 | 4

/**
 * Detección real de tonalidad (Fase 5 — DJ Engine). Definido acá por
 * el mismo motivo que `BeatGrid`: lo comparten `useDeckEngine.ts`
 * (`detectKey`) y `musicLibraryRepository.ts` sin import circular.
 */
export interface KeyDetection {
  tonic: string
  scale: 'major' | 'minor'
  /** Notación Camelot real (rueda de mezcla armónica de DJ), ej. "8A". */
  camelot: string
  /** Correlación de Pearson real contra el perfil tonal ganador (-1..1) — no un valor inventado. Baja en material atonal/percusivo, eso es correcto, no un error. */
  confidence: number
}

/**
 * Análisis real de energía (Fase 6 — DJ Engine). Definido acá por el
 * mismo motivo que `BeatGrid`/`KeyDetection`: lo comparten
 * `useDeckEngine.ts` (`computeEnergyProfile`) y
 * `musicLibraryRepository.ts` sin import circular.
 */
export interface EnergyWindow {
  timeSec: number
  rms: number
  peak: number
  zcr: number
}

export interface EnergyProfile {
  overallRms: number
  overallPeak: number
  dynamicRangeDb: number
  curve: EnergyWindow[]
}

/**
 * Estructura real (Fase 7 — DJ Engine). Definido acá por el mismo
 * motivo que `BeatGrid`/`KeyDetection`/`EnergyProfile`. Solo posición
 * intro/outro/drop-candidato/tramo-flojo — sin verso/estribillo/voz/
 * instrumental (no implementado, requeriría reconocimiento semántico
 * real que no existe en este proyecto).
 */
export interface StructureAnalysis {
  introEndSec: number | null
  outroStartSec: number | null
  dropCandidates: number[]
  quietSections: { startSec: number; endSec: number }[]
}

/**
 * Fase 2 — Smart Music Library (MABRIONA DJ Engine). Estado real del
 * análisis de un track de la biblioteca — nunca "fully analyzed": Key,
 * Beat Grid, Energy, Structure y Compatibility quedan fuera de esta
 * fase a propósito, así que `ready` significa solo "duración/BPM/
 * waveform reales listos", no "análisis completo".
 */
export type AnalysisStatus = 'not_analyzed' | 'analyzing' | 'ready' | 'error'

/**
 * Entidad real de la biblioteca local — identidad estable e
 * independiente de qué deck (A/B) la tenga cargada en un momento dado
 * (a diferencia de `trackStorage.ts`, que persiste por SLOT de deck).
 * `artist`/`album`/`genre`/`year`/`trackNumber`/`comment`/
 * `artworkDataUrl`/`bitrateKbps`/`sampleRateHz` quedan `null` hasta que
 * el archivo realmente tenga esos tags ID3/Vorbis/iTunes (Fase 3 —
 * `readRealMetadata` en `musicLibraryRepository.ts`, vía `music-metadata`)
 * — nunca un valor inventado. `title` arranca como el nombre del
 * archivo y se reemplaza por el tag real si el archivo lo trae.
 */
export interface LocalMusicTrack {
  id: string
  filename: string
  title: string
  artist: string | null
  album: string | null
  genre: string | null
  year: number | null
  trackNumber: number | null
  comment: string | null
  artworkDataUrl: string | null
  bitrateKbps: number | null
  sampleRateHz: number | null
  durationSec: number | null
  format: string
  mimeType: string
  sizeBytes: number
  bpm: number | null
  peaks: number[] | null
  /** Grid de beats real (Fase 4) — `null` hasta terminar el análisis, igual que `bpm`/`peaks`. */
  beatGrid: BeatGrid | null
  /** Tonalidad real (Fase 5) — `null` hasta terminar el análisis. */
  key: KeyDetection | null
  /** Energía/dinámica real (Fase 6) — `null` hasta terminar el análisis. */
  energyProfile: EnergyProfile | null
  /** Estructura real — solo intro/outro/drop-candidato/tramo-flojo (Fase 7) — `null` hasta terminar el análisis. */
  structure: StructureAnalysis | null
  /** Hot Cues reales persistidos por identidad de track (Fase 12) — `null` hasta que el usuario marque el primero en cualquier deck. */
  hotCues: HotCue[] | null
  analysisStatus: AnalysisStatus
  errorMessage?: string
  createdAt: number
  updatedAt: number
}
