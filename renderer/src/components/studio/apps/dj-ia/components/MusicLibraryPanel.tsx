import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent } from 'react'
import { IconMusic, IconSearch, IconTrash, IconUpload } from '../../../../shared/icons'
import {
  analyzeTrack,
  deleteTrack,
  enqueueAnalysis,
  getTrack,
  getTrackFile,
  listTracks,
  registerFiles,
} from '../engine/musicLibraryRepository'
import type { LocalMusicTrack } from '../types'

/** 222.4 → "3:42". `null` mientras el track no terminó el análisis o falló. */
function fmtDuration(sec: number | null): string {
  if (sec == null) return '—'
  const m = Math.floor(sec / 60)
  const s = Math.floor(sec % 60)
  return `${m}:${s.toString().padStart(2, '0')}`
}

function fmtBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

const STATUS_LABEL: Record<LocalMusicTrack['analysisStatus'], string> = {
  not_analyzed: 'Sin analizar',
  analyzing: 'Analizando…',
  ready: 'Listo',
  error: 'Error',
}

/**
 * MÚSICA LOCAL — Fase 2 (Smart Music Library). Track Registry real:
 * archivos importados de a uno, en lote, o por carpeta completa
 * (`webkitdirectory`) quedan con identidad estable propia (no atada a
 * un deck), se analizan con el MISMO `detectBpm`/`computePeaks` que ya
 * usan los platos (`musicLibraryRepository.ts`), y se persisten en el
 * store `library` de la base IndexedDB `mabriona-dj-ia` que ya existía
 * para "PISTA" — nada de esto duplica esa infraestructura.
 *
 * A propósito NO tiene columnas de Key/Energy/Compatibility — esas
 * capacidades no existen todavía (ver auditoría de Fase 1); "Listo"
 * significa solo que duración/BPM/waveform reales están disponibles.
 */
export function MusicLibraryPanel({ onLoadToDeck }: { onLoadToDeck: (file: File, track: LocalMusicTrack, deck: 1 | 2) => void }) {
  const [tracks, setTracks] = useState<LocalMusicTrack[]>([])
  const [loaded, setLoaded] = useState(false)
  const [query, setQuery] = useState('')
  const [bpmMin, setBpmMin] = useState('')
  const [bpmMax, setBpmMax] = useState('')
  const [formatFilter, setFormatFilter] = useState('all')
  const [readyOnly, setReadyOnly] = useState(false)
  const [pickingDeckFor, setPickingDeckFor] = useState<string | null>(null)
  const [dragOver, setDragOver] = useState(false)
  const [importMsg, setImportMsg] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const folderInputRef = useRef<HTMLInputElement>(null)

  const refresh = useCallback(() => { listTracks().then((t) => { setTracks(t); setLoaded(true) }) }, [])
  useEffect(() => { refresh() }, [refresh])

  const applyTrackUpdate = useCallback((updated: LocalMusicTrack) => {
    setTracks((prev) => prev.map((t) => (t.id === updated.id ? updated : t)))
  }, [])

  const handleFiles = useCallback(async (fileList: FileList | File[]) => {
    const files = Array.from(fileList)
    if (files.length === 0) return
    const { added, duplicates, skipped } = await registerFiles(files)
    if (added.length > 0) setTracks((prev) => [...added, ...prev])
    const parts: string[] = []
    if (added.length) parts.push(`${added.length} track${added.length === 1 ? '' : 's'} nuevo${added.length === 1 ? '' : 's'}`)
    if (duplicates.length) parts.push(`${duplicates.length} ya estaba${duplicates.length === 1 ? '' : 'n'} en la biblioteca`)
    if (skipped) parts.push(`${skipped} archivo${skipped === 1 ? '' : 's'} ignorado${skipped === 1 ? '' : 's'} (no es audio)`)
    setImportMsg(parts.join(' · ') || 'Nada para importar')
    if (added.length > 0) enqueueAnalysis(added.map((t) => t.id), applyTrackUpdate)
  }, [applyTrackUpdate])

  const onDrop = useCallback((e: DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    setDragOver(false)
    if (e.dataTransfer.files?.length) void handleFiles(e.dataTransfer.files)
  }, [handleFiles])

  const filtered = useMemo(() => {
    let list = tracks
    const q = query.trim().toLowerCase()
    if (q) list = list.filter((t) => t.title.toLowerCase().includes(q) || (t.artist ?? '').toLowerCase().includes(q) || t.filename.toLowerCase().includes(q))
    if (readyOnly) list = list.filter((t) => t.analysisStatus === 'ready')
    if (formatFilter !== 'all') list = list.filter((t) => t.format === formatFilter)
    const min = Number(bpmMin)
    const max = Number(bpmMax)
    if (bpmMin.trim() && !Number.isNaN(min)) list = list.filter((t) => t.bpm != null && t.bpm >= min)
    if (bpmMax.trim() && !Number.isNaN(max)) list = list.filter((t) => t.bpm != null && t.bpm <= max)
    return list
  }, [tracks, query, readyOnly, formatFilter, bpmMin, bpmMax])

  const formats = useMemo(() => Array.from(new Set(tracks.map((t) => t.format))).sort(), [tracks])

  const handleLoad = useCallback(async (track: LocalMusicTrack, deck: 1 | 2) => {
    const file = await getTrackFile(track.id)
    if (!file) { setImportMsg(`"${track.title}" ya no está disponible (archivo eliminado o movido).`); return }
    // Releer el registro real (Fase 12): los Hot Cues se persisten
    // desde el deck sin pasar por el estado local de esta lista, así
    // que la copia en memoria puede tener `hotCues` viejos.
    const fresh = (await getTrack(track.id)) ?? track
    onLoadToDeck(file, fresh, deck)
    setPickingDeckFor(null)
  }, [onLoadToDeck])

  const handleDelete = useCallback(async (id: string) => {
    await deleteTrack(id)
    setTracks((prev) => prev.filter((t) => t.id !== id))
  }, [])

  const handleRetry = useCallback(async (id: string) => {
    applyTrackUpdate({ ...tracks.find((t) => t.id === id)!, analysisStatus: 'analyzing' })
    const updated = await analyzeTrack(id, { force: true })
    if (updated) applyTrackUpdate(updated)
  }, [applyTrackUpdate, tracks])

  return (
    <div className="flex h-full flex-col gap-3 overflow-hidden text-white/90">
      {/* Importar: múltiple, carpeta, o arrastrar y soltar */}
      <div
        onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
        onDragLeave={() => setDragOver(false)}
        onDrop={onDrop}
        className={`flex flex-wrap items-center gap-2 rounded-lg border border-dashed p-2.5 transition-colors ${dragOver ? 'border-[#d4ff00] bg-[#d4ff00]/[0.06]' : 'border-white/15'}`}
      >
        <IconUpload className="h-4 w-4 shrink-0 text-white/40" />
        <span className="text-[10.5px] text-white/40">Arrastrá archivos o una carpeta acá, o</span>
        <button type="button" onClick={() => fileInputRef.current?.click()} className="rounded-full border border-white/20 px-2.5 py-1 text-[10px] font-semibold text-white/70 hover:border-white/40 hover:text-white">
          Elegir archivos
        </button>
        <button type="button" onClick={() => folderInputRef.current?.click()} className="rounded-full border border-white/20 px-2.5 py-1 text-[10px] font-semibold text-white/70 hover:border-white/40 hover:text-white">
          Elegir carpeta
        </button>
        <input ref={fileInputRef} type="file" accept="audio/*" multiple className="hidden" onChange={(e) => { if (e.target.files) void handleFiles(e.target.files); e.target.value = '' }} />
        <input
          ref={folderInputRef}
          type="file"
          // `webkitdirectory` no tiene tipos oficiales en React — atributo real soportado por Chrome/Edge/Safari/Firefox modernos.
          {...{ webkitdirectory: 'true', directory: 'true' } as Record<string, string>}
          multiple
          className="hidden"
          onChange={(e) => { if (e.target.files) void handleFiles(e.target.files); e.target.value = '' }}
        />
      </div>
      {importMsg && <p className="text-[10px] text-white/40">{importMsg}</p>}

      {/* Búsqueda + filtros */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex min-w-[180px] flex-1 items-center gap-2 rounded-lg border border-white/10 bg-black/40 px-3 py-2">
          <IconSearch className="h-3.5 w-3.5 text-white/40" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Buscar por título, artista o archivo…"
            className="w-full bg-transparent text-xs text-white outline-none placeholder:text-white/30"
          />
        </div>
        <input
          value={bpmMin}
          onChange={(e) => setBpmMin(e.target.value)}
          placeholder="BPM mín"
          inputMode="numeric"
          className="w-20 rounded-lg border border-white/10 bg-black/40 px-2 py-2 text-[10px] text-white outline-none placeholder:text-white/30"
        />
        <input
          value={bpmMax}
          onChange={(e) => setBpmMax(e.target.value)}
          placeholder="BPM máx"
          inputMode="numeric"
          className="w-20 rounded-lg border border-white/10 bg-black/40 px-2 py-2 text-[10px] text-white outline-none placeholder:text-white/30"
        />
        <select
          value={formatFilter}
          onChange={(e) => setFormatFilter(e.target.value)}
          className="rounded-lg border border-white/10 bg-black/40 px-2 py-2 text-[10px] text-white outline-none"
        >
          <option value="all">Todos los formatos</option>
          {formats.map((f) => <option key={f} value={f}>{f.toUpperCase()}</option>)}
        </select>
        <button
          type="button"
          onClick={() => setReadyOnly((v) => !v)}
          className={`rounded-full px-2.5 py-1.5 text-[10px] font-semibold ${readyOnly ? 'bg-[#d4ff00] text-black' : 'border border-white/15 text-white/60 hover:border-white/30'}`}
        >
          Solo analizados
        </button>
      </div>

      {/* Tabla */}
      <div className="flex-1 overflow-y-auto pr-1">
        {!loaded ? (
          <p className="py-10 text-center text-xs text-white/30">Cargando biblioteca…</p>
        ) : filtered.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 py-10 text-center text-white/30">
            <IconMusic className="h-6 w-6" />
            <p className="text-xs">
              {tracks.length === 0 ? 'Todavía no importaste ningún archivo local.' : 'Nada coincide con la búsqueda/filtros.'}
            </p>
          </div>
        ) : (
          <table className="w-full border-collapse text-[11px]">
            <thead>
              <tr className="border-b border-white/10 text-left text-[9.5px] font-bold uppercase tracking-wide text-white/30">
                <th className="py-1.5 pr-2">Título</th>
                <th className="py-1.5 pr-2">Artista</th>
                <th className="py-1.5 pr-2">Duración</th>
                <th className="py-1.5 pr-2">BPM</th>
                <th className="py-1.5 pr-2">Formato</th>
                <th className="py-1.5 pr-2">Estado</th>
                <th className="py-1.5 pr-2" />
              </tr>
            </thead>
            <tbody>
              {filtered.map((track) => (
                <tr key={track.id} className="border-b border-white/[0.06] hover:bg-white/[0.03]">
                  <td className="max-w-[220px] truncate py-1.5 pr-2 font-semibold text-white" title={track.filename}>{track.title}</td>
                  <td className="py-1.5 pr-2 text-white/50">{track.artist ?? 'Desconocido'}</td>
                  <td className="py-1.5 pr-2 font-mono text-white/50">{fmtDuration(track.durationSec)}</td>
                  <td className="py-1.5 pr-2 font-mono text-white/50">{track.bpm != null ? track.bpm.toFixed(1) : '—'}</td>
                  <td className="py-1.5 pr-2 text-white/40">
                    {track.format.toUpperCase()} · {fmtBytes(track.sizeBytes)}
                  </td>
                  <td className="py-1.5 pr-2">
                    {track.analysisStatus === 'error' ? (
                      <button type="button" onClick={() => void handleRetry(track.id)} className="text-[9.5px] font-bold text-red-400 underline decoration-red-400/40 underline-offset-2" title={track.errorMessage}>
                        Error — reintentar
                      </button>
                    ) : (
                      <span className={track.analysisStatus === 'ready' ? 'text-[#d4ff00]' : 'text-white/40'}>
                        {STATUS_LABEL[track.analysisStatus]}
                      </span>
                    )}
                  </td>
                  <td className="py-1.5 pr-1">
                    <div className="flex items-center justify-end gap-1">
                      <div className="relative shrink-0">
                        <button
                          type="button"
                          disabled={track.analysisStatus === 'error'}
                          onClick={() => setPickingDeckFor((id) => (id === track.id ? null : track.id))}
                          className="rounded-full bg-[#d4ff00] px-2.5 py-1 text-[10px] font-bold text-black disabled:opacity-30"
                        >
                          Cargar
                        </button>
                        {pickingDeckFor === track.id && (
                          <div className="absolute right-0 top-[calc(100%+4px)] z-10 flex gap-1 rounded-lg border border-white/10 bg-[#141414] p-1.5 shadow-xl">
                            <button type="button" onClick={() => void handleLoad(track, 1)} className="rounded px-2.5 py-1 text-[10px] font-bold text-black" style={{ background: '#d4ff00' }}>Plato 1</button>
                            <button type="button" onClick={() => void handleLoad(track, 2)} className="rounded px-2.5 py-1 text-[10px] font-bold text-black" style={{ background: '#b26bff' }}>Plato 2</button>
                          </div>
                        )}
                      </div>
                      <button type="button" onClick={() => void handleDelete(track.id)} aria-label="Quitar de la biblioteca" className="shrink-0 rounded-full p-1.5 text-white/25 hover:text-red-400">
                        <IconTrash className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
