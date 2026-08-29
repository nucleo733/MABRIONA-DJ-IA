import { parseBlob } from 'music-metadata'
import type { AnalysisStatus, HotCue, LocalMusicTrack } from '../types'
import { analyzeStructure, computeEnergyProfile, computePeaks, detectBeatGrid, detectKey } from './useDeckEngine'
import {
  deleteLibraryRecord,
  getLibraryRecord,
  listLibraryRecords,
  putLibraryRecord,
  type LibraryRecord,
} from './trackStorage'

/**
 * Fase 2 — MABRIONA Smart Music Library (Track Registry real).
 * Fase 3 — Metadata real (ID3/Vorbis/iTunes) sobre la misma entidad.
 *
 * Reutiliza `detectBpm`/`computePeaks` de `useDeckEngine.ts` (mismo
 * análisis real que ya usan los decks — no se reimplementa), el store
 * `library` de `trackStorage.ts` (misma base IndexedDB
 * `mabriona-dj-ia`, no una segunda base), y las columnas Título/Artista
 * que ya existían en `MusicLibraryPanel.tsx` (no se agrega UI nueva —
 * regla explícita de Fase 3: "NO cambiar la interfaz"). Álbum/género/
 * año/pista/comentario/portada/bitrate/sample rate no tienen columna
 * visible todavía: quedan persistidos en el registro igual, listos
 * para cuando una fase futura les dé un lugar en pantalla.
 */

type MetadataFields = Pick<LocalMusicTrack, 'title' | 'artist' | 'album' | 'genre' | 'year' | 'trackNumber' | 'comment' | 'artworkDataUrl' | 'bitrateKbps' | 'sampleRateHz'>

function pictureToDataUrl(picture: { format: string; data: Uint8Array }): Promise<string> {
  return new Promise((resolve, reject) => {
    const blob = new Blob([Uint8Array.from(picture.data)], { type: picture.format })
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(blob)
  })
}

/**
 * Metadata REAL leída del archivo (`music-metadata`, `parseBlob` — el
 * mismo parser real de ID3v1/v2, Vorbis comments (FLAC/OGG) y átomos
 * iTunes (M4A/AAC) que usa cualquier reproductor). Muchos archivos
 * simplemente no traen tags — eso no es un error, cada campo ausente
 * queda `null`/el valor por defecto (`title` = nombre de archivo), tal
 * como ya funcionaba antes de esta fase. Solo un archivo genuinamente
 * ilegible (no confundir con "sin tags") cae al `catch` y devuelve
 * todo en default.
 */
async function readRealMetadata(file: File): Promise<MetadataFields> {
  const fallback: MetadataFields = {
    title: file.name.replace(/\.[^./]+$/, ''),
    artist: null, album: null, genre: null, year: null,
    trackNumber: null, comment: null, artworkDataUrl: null,
    bitrateKbps: null, sampleRateHz: null,
  }
  try {
    const meta = await parseBlob(file)
    const { common, format } = meta
    const picture = common.picture?.[0]
    return {
      title: common.title?.trim() || fallback.title,
      artist: common.artist?.trim() || null,
      album: common.album?.trim() || null,
      genre: common.genre?.length ? common.genre.join(', ') : null,
      year: common.year ?? null,
      trackNumber: common.track?.no ?? null,
      comment: common.comment?.[0]?.text?.trim() || null,
      artworkDataUrl: picture ? await pictureToDataUrl(picture).catch(() => null) : null,
      bitrateKbps: format.bitrate ? Math.round(format.bitrate / 1000) : null,
      sampleRateHz: format.sampleRate ?? null,
    }
  } catch (err) {
    console.warn('[MusicLibrary] no se pudo leer metadata real de', file.name, err)
    return fallback
  }
}

function extOf(filename: string): string {
  const m = filename.match(/\.([^./]+)$/)
  return m ? m[1].toLowerCase() : ''
}

/** Extensiones de audio reconocidas para filtrar una carpeta importada (imágenes, .txt, etc. quedan afuera). El soporte REAL de decodificación lo decide `decodeAudioData` al analizar, no esta lista. */
const AUDIO_EXTENSIONS = new Set(['mp3', 'wav', 'flac', 'm4a', 'aac', 'aiff', 'aif', 'ogg'])

export function looksLikeAudio(file: File): boolean {
  if (file.type.startsWith('audio/')) return true
  return AUDIO_EXTENSIONS.has(extOf(file.name))
}

/**
 * Identidad estable de un archivo — independiente del deck que lo
 * cargue. `name + size + lastModified` es suficiente para este MVP
 * (evita duplicados reales del mismo archivo) sin el costo de un
 * fingerprint/hash de audio completo, que la Fase 2 marca como
 * innecesario salvo que haga falta.
 */
export function computeFileIdentity(file: File): string {
  return `${file.name}::${file.size}::${file.lastModified}`
}

function stripFile(record: LibraryRecord): LocalMusicTrack {
  const { file: _file, ...track } = record
  return track
}

export interface RegisterResult {
  added: LocalMusicTrack[]
  duplicates: LocalMusicTrack[]
  skipped: number
}

/**
 * Registra uno o más archivos en la biblioteca. Si el mismo archivo
 * (misma identidad) ya existe, NO crea un segundo registro ni vuelve a
 * calcular BPM/waveform — devuelve el existente en `duplicates`.
 * Archivos que no parecen audio (relevante al importar una carpeta
 * entera) se cuentan en `skipped`, nunca se registran como error falso.
 */
export async function registerFiles(files: File[]): Promise<RegisterResult> {
  const existing = await listLibraryRecords()
  const byId = new Map(existing.map((r) => [r.id, r]))
  const added: LocalMusicTrack[] = []
  const duplicates: LocalMusicTrack[] = []
  let skipped = 0

  for (const file of files) {
    if (!looksLikeAudio(file)) { skipped++; continue }
    const id = computeFileIdentity(file)
    const existingRecord = byId.get(id)
    if (existingRecord) { duplicates.push(stripFile(existingRecord)); continue }

    const now = Date.now()
    const record: LibraryRecord = {
      id,
      file,
      filename: file.name,
      title: file.name.replace(/\.[^./]+$/, ''),
      artist: null,
      album: null,
      genre: null,
      year: null,
      trackNumber: null,
      comment: null,
      artworkDataUrl: null,
      bitrateKbps: null,
      sampleRateHz: null,
      durationSec: null,
      format: extOf(file.name) || 'unknown',
      mimeType: file.type || 'application/octet-stream',
      sizeBytes: file.size,
      bpm: null,
      peaks: null,
      beatGrid: null,
      key: null,
      energyProfile: null,
      structure: null,
      hotCues: null,
      analysisStatus: 'not_analyzed',
      createdAt: now,
      updatedAt: now,
    }
    await putLibraryRecord(record)
    byId.set(id, record)
    added.push(stripFile(record))
  }
  return { added, duplicates, skipped }
}

export async function listTracks(): Promise<LocalMusicTrack[]> {
  const records = await listLibraryRecords()
  return records.map(stripFile).sort((a, b) => b.createdAt - a.createdAt)
}

export async function getTrackFile(id: string): Promise<File | null> {
  const record = await getLibraryRecord(id)
  return record?.file ?? null
}

/**
 * Registro real y actual de un track — a diferencia de la lista que
 * mantiene `MusicLibraryPanel.tsx` en memoria (cargada una vez y solo
 * parchada vía `enqueueAnalysis`), esto siempre lee el estado real
 * persistido en IndexedDB. Necesario para Fase 12: los Hot Cues se
 * escriben desde `DjIaScreen.tsx` (`updateTrackHotCues`, al tocar los
 * pads en el deck) sin pasar por el estado local del panel, así que
 * antes de mandar un track a un plato hay que releerlo para no
 * cargarlo con Hot Cues viejos.
 */
export async function getTrack(id: string): Promise<LocalMusicTrack | null> {
  const record = await getLibraryRecord(id)
  return record ? stripFile(record) : null
}

export async function deleteTrack(id: string): Promise<void> {
  await deleteLibraryRecord(id)
}

/**
 * Fase 12 — Memory Cues reales: persiste los Hot Cues por IDENTIDAD de
 * track (no por slot de deck, a diferencia de `trackStorage.ts` ->
 * `saveTrack`/`loadTrack`), así el mismo track vuelve a mostrar sus
 * marcas reales sin importar en qué plato se cargue después.
 */
export async function updateTrackHotCues(id: string, hotCues: HotCue[]): Promise<LocalMusicTrack | null> {
  const record = await getLibraryRecord(id)
  if (!record) return null
  const updated: LibraryRecord = { ...record, hotCues, updatedAt: Date.now() }
  await putLibraryRecord(updated)
  return stripFile(updated)
}

async function updateStatus(id: string, patch: Partial<LocalMusicTrack> & { analysisStatus: AnalysisStatus }): Promise<LocalMusicTrack | null> {
  const record = await getLibraryRecord(id)
  if (!record) return null
  const updated: LibraryRecord = { ...record, ...patch, updatedAt: Date.now() }
  await putLibraryRecord(updated)
  return stripFile(updated)
}

/**
 * AudioContext exclusivo de análisis — nunca conectado a ningún
 * destino de salida (no es un segundo motor de reproducción, es
 * `decodeAudioData` + los mismos analizadores reales de
 * `useDeckEngine.ts`, corridos fuera de cualquier deck).
 */
let analysisCtx: AudioContext | null = null
function getAnalysisContext(): AudioContext {
  if (!analysisCtx) analysisCtx = new AudioContext()
  return analysisCtx
}

/**
 * Analiza un track ya registrado: duración/BPM/waveform reales sobre
 * el `File` real guardado, MÁS metadata real (Fase 3) leída en
 * paralelo del mismo archivo. Si ya tiene BPM+peaks (`ready`), no
 * vuelve a decodificar ni a releer tags — evita recalcular
 * innecesariamente (regla de Fase 2/3). Si el AUDIO no puede
 * decodificarse, queda en `error` con el motivo real — nunca se
 * inventa duración/BPM/waveform. La metadata es best-effort aparte:
 * un archivo sin tags no es un error (la mayoría no los tiene).
 */
export async function analyzeTrack(id: string, opts?: { force?: boolean }): Promise<LocalMusicTrack | null> {
  const record = await getLibraryRecord(id)
  if (!record) return null
  if (!opts?.force && record.analysisStatus === 'ready') return stripFile(record)

  await updateStatus(id, { analysisStatus: 'analyzing' })
  try {
    const [decoded, metadata] = await Promise.all([
      record.file.arrayBuffer().then((data) => getAnalysisContext().decodeAudioData(data)),
      readRealMetadata(record.file),
    ])
    // `detectBeatGrid` ya corre `detectBpm` internamente para el
    // período — se deriva el BPM del grid en vez de llamarlo dos veces.
    const beatGrid = detectBeatGrid(decoded)
    const bpm = Math.round((60 / beatGrid.periodSec) * 10) / 10
    const peaks = computePeaks(decoded)
    const key = detectKey(decoded)
    const energyProfile = computeEnergyProfile(decoded)
    const structure = analyzeStructure(energyProfile)
    const updated = await updateStatus(id, {
      analysisStatus: 'ready',
      durationSec: decoded.duration,
      bpm,
      peaks,
      beatGrid,
      key,
      energyProfile,
      structure,
      ...metadata,
      errorMessage: undefined,
    })
    return updated
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return updateStatus(id, {
      analysisStatus: 'error',
      errorMessage: `No se pudo decodificar el archivo: ${message}`,
    })
  }
}

/**
 * Cola de análisis secuencial (un track a la vez) — evitar decodificar
 * varios audios completos en simultáneo (regla de performance de Fase
 * 2). `onTrackUpdated` avisa a la UI en cada paso para reflejar
 * NOT_ANALYZED → ANALYZING → READY/ERROR en tiempo real.
 */
let queueRunning = false
const pendingQueue: string[] = []
const queuedIds = new Set<string>()

export function enqueueAnalysis(ids: string[], onTrackUpdated: (track: LocalMusicTrack) => void): void {
  for (const id of ids) {
    if (queuedIds.has(id)) continue
    queuedIds.add(id)
    pendingQueue.push(id)
  }
  void runQueue(onTrackUpdated)
}

async function runQueue(onTrackUpdated: (track: LocalMusicTrack) => void): Promise<void> {
  if (queueRunning) return
  queueRunning = true
  while (pendingQueue.length > 0) {
    const id = pendingQueue.shift()!
    queuedIds.delete(id)
    const result = await analyzeTrack(id)
    if (result) onTrackUpdated(result)
  }
  queueRunning = false
}
