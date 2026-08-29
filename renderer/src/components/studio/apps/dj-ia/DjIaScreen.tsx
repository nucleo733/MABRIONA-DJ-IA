import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent } from 'react'
import { IconExpand, IconPause, IconPlay, IconRepeat, IconShuffle, IconSkipBack, IconSkipForward, IconVideoFrame, IconVolume, IconWindow } from '../../../shared/icons'
import { useAudioEngine } from './engine/useAudioEngine'
import { useDeckEngine, type DeckEngine } from './engine/useDeckEngine'
import { saveTrack as saveAutoMixTrack, loadTrack as loadAutoMixTrack } from './engine/trackStorage'
import { createKaraokeTrack, preloadKaraokeEncoder } from './engine/karaokeProcessor'
import type { ColorFxType, EqBand, HotCue, LoopRegion, PadMode } from './types'
import { HOTCUE_SLOTS, LOOP_LENGTHS } from './types'
import { JogWheel, type RingLightEffect, type YtOverride } from './components/JogWheel'
import { LibraryPanel, addToDjIaLibrary } from './components/LibraryPanel'
import { MusicCatalogPicker } from './components/MusicCatalogPicker'
import { MusicLibraryPanel } from './components/MusicLibraryPanel'
import { updateTrackHotCues } from './engine/musicLibraryRepository'
import { getGenreWeights, logDjSessionEnded, logDjSessionStarted, readProfile, weightedShuffle } from '../../../../core/musicIntelligence'
import { describeYoutubeError, isValidYoutubeVideoId, volumeToYoutubeScale } from './engine/youtubePlayback'
import { useAuth } from '../../../../auth/AuthContext'

/** Metadata opcional de YouTube (título/canal/miniatura/duración) que viaja junto con id+título al agregar un video — la usa la Biblioteca para no guardar solo un id pelado. */
interface YtMeta {
  channel?: string
  thumbnail?: string
  durationSec?: number | null
}

const RING_LIGHT_EFFECTS: RingLightEffect[] = ['static', 'pulse', 'chase', 'strobe']
const RING_LIGHT_LABELS: Record<RingLightEffect, string> = { static: 'FIJO', pulse: 'PULSO', chase: 'GIRO', strobe: 'STROBE' }

const PAD_MODE_BUTTONS: { label: string; mode: PadMode }[] = [
  { label: 'HOT CUE', mode: 'hotcue' },
  { label: 'PAD FX', mode: 'padfx' },
  { label: 'BEAT LOOP', mode: 'beatloop' },
  { label: 'SAMPLER', mode: 'sampler' },
  { label: 'BEAT JUMP', mode: 'beatjump' },
  { label: 'KEYBOARD', mode: 'keyboard' },
]

function loopLabelToBeats(label: string): number {
  return label === '1/2' ? 0.5 : Number(label)
}

const QUICK_LOOP_LABELS = ['1/2', '1', '2', '4', '8', '16', '32']

const VIDEO_TABS = ['SOURCE', 'RESUMEN', 'HISTORIAL', 'MEZCLA', 'BIBLIOTECA', 'MÚSICA LOCAL', 'AYUDA', 'CONFIG'] as const
type VideoTab = (typeof VIDEO_TABS)[number]

function fmtTime(s: number): string {
  const m = Math.floor(s / 60)
  const sec = Math.floor(s % 60)
  return `${m}:${sec.toString().padStart(2, '0')}`
}

function extractYoutubeId(input: string): string | null {
  const trimmed = input.trim()
  if (/^[\w-]{11}$/.test(trimmed)) return trimmed
  const match = trimmed.match(/(?:youtu\.be\/|youtube\.com\/(?:watch\?v=|embed\/|shorts\/))([\w-]{11})/)
  return match ? match[1] : null
}

type YtStatus = 'idle' | 'checking' | 'exists' | 'missing' | 'error'

/**
 * Búsqueda/verificación de YouTube vía IPC al proceso main de
 * Electron — ahí viven las claves (Brave/YouTube Data API), nunca en
 * este renderer. `main.js` hace el fetch real contra
 * mabriona.com/api/search|check y devuelve el JSON ya resuelto.
 */
async function djiaFetch(url: string): Promise<Response> {
  const [pathPart, query] = url.split('?')
  const params = new URLSearchParams(query)
  const result =
    pathPart === '/api/check'
      ? await window.djia.checkYoutubeVideo(params.get('id') ?? '')
      : await window.djia.searchYoutube(params.get('q') ?? '', { safe: params.get('safe') === '1' })
  return { ok: result.ok, status: result.status, json: async () => result.data } as Response
}

/**
 * Tiempo límite (no se cuelga para siempre si la red está lenta) y
 * reintentos automáticos solo para fallas que tienen sentido
 * reintentar: caída de red o un 5xx pasajero. Un 4xx (parámetro mal
 * puesto, falta la clave configurada) no se reintenta — reintentar
 * eso no lo arregla, solo demoraría el mensaje de error real.
 */
async function fetchConReintentos(url: string, { retries = 2, timeoutMs = 8000 } = {}): Promise<Response> {
  let lastError: unknown
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await Promise.race([
        djiaFetch(url),
        new Promise<never>((_, reject) => setTimeout(() => reject(new Error('timeout')), timeoutMs)),
      ])
      if (res.ok || res.status < 500) return res // éxito, o error del cliente que no vale la pena reintentar
      lastError = new Error(`HTTP ${res.status}`)
    } catch (err) {
      lastError = err
    }
    if (attempt < retries) await new Promise((r) => setTimeout(r, 400 * (attempt + 1)))
  }
  throw lastError
}

/** Menú "Agregar": Biblioteca o Buscar en YouTube — los dos preguntan a qué plato va (elige el deck que muestra/identifica ese contenido), y también se puede quitar el video actual desde acá mismo. */
function AddMenu({ onLoadFile, onLoadYoutube, onAddToList, onRemoveVideo, hasVideo, cleanMode, accountId, onAddCatalogToAutoMix }: {
  onLoadFile: (file: File, deck: 1 | 2) => void
  onLoadYoutube: (id: string, title: string, deck: 1 | 2, meta?: YtMeta) => void
  onAddToList: (id: string, title: string, meta?: YtMeta) => void
  onRemoveVideo: () => void
  hasVideo: boolean
  cleanMode: boolean
  /** Fase X — catálogo propio de MUSIC como tercer origen. */
  accountId: string | null
  onAddCatalogToAutoMix: (file: File, title: string) => void
}) {
  const [open, setOpen] = useState(false)
  const [ytMode, setYtMode] = useState(false)
  const [catalogMode, setCatalogMode] = useState(false)
  // 'deck': cargarlo para sonar ahora en un plato (comportamiento de
  // siempre). 'list': sumarlo a la Lista Automática de la pestaña
  // MEZCLA sin tocar ningún plato — misma ventana de búsqueda, destino
  // distinto.
  const [addTarget, setAddTarget] = useState<'deck' | 'list'>('deck')
  const [pickingDeck, setPickingDeck] = useState(false)
  const [pendingYt, setPendingYt] = useState<{ id: string; title: string; channel?: string; thumbnail?: string; durationSec?: number | null } | null>(null)
  const [ytInput, setYtInput] = useState('')
  const [ytStatus, setYtStatus] = useState<YtStatus>('idle')
  const [ytFoundId, setYtFoundId] = useState<string | null>(null)
  const [ytFoundTitle, setYtFoundTitle] = useState<string | null>(null)
  const [ytFoundChannel, setYtFoundChannel] = useState<string | null>(null)
  const [ytFoundThumbnail, setYtFoundThumbnail] = useState<string | null>(null)
  const [ytFoundDuration, setYtFoundDuration] = useState<number | null>(null)
  const [ytResults, setYtResults] = useState<{ id: string; title: string; channel?: string; thumbnail?: string; durationSec?: number | null }[]>([])
  const [carouselOpen, setCarouselOpen] = useState(false)
  const [justAdded, setJustAdded] = useState<string | null>(null)
  const ytRequestRef = useRef(0)

  const close = () => { setOpen(false); setYtMode(false); setCatalogMode(false); setAddTarget('deck'); setPickingDeck(false); setPendingYt(null); setYtInput(''); setYtStatus('idle'); setYtFoundId(null); setYtFoundTitle(null); setYtFoundChannel(null); setYtFoundThumbnail(null); setYtFoundDuration(null); setYtResults([]); setCarouselOpen(false); setJustAdded(null); ytRequestRef.current += 1 }

  const elegirResultado = (r: { id: string; title: string; channel?: string; thumbnail?: string; durationSec?: number | null }) => {
    // A la lista: se agrega directo, sin elegir plato, y el carrusel
    // queda abierto para poder seguir sumando varios de un tirón.
    if (addTarget === 'list') {
      onAddToList(r.id, r.title, { channel: r.channel, thumbnail: r.thumbnail, durationSec: r.durationSec })
      setJustAdded(r.id)
      setTimeout(() => setJustAdded((id) => (id === r.id ? null : id)), 1200)
      return
    }
    setPendingYt(r)
    setYtResults([])
    setCarouselOpen(false)
    setPickingDeck(true)
  }

  // Nunca sale de la app: si es un link de YouTube, verifica que ese
  // video exacto exista (check.ts); si es texto, busca de verdad
  // (search.ts) y toma el primer resultado. En los dos casos el
  // resultado se muestra acá adentro, nunca en otra pestaña.
  //
  // ytRequestRef descarta respuestas viejas: si tocás Buscar dos
  // veces seguidas (o cambiás el texto mientras la primera todavía
  // no respondió), solo cuenta la última — nunca pisa el resultado
  // correcto con uno atrasado. r.ok distingue "no existe" (respuesta
  // real de YouTube) de "no se pudo preguntar" (falla del servidor).
  const buscar = () => {
    if (!ytInput.trim() || ytStatus === 'checking') return
    const id = extractYoutubeId(ytInput)
    const requestId = ++ytRequestRef.current
    setYtStatus('checking')
    setYtResults([])
    if (!id) setCarouselOpen(true) // búsqueda por nombre: abre el carrusel ya, se llena cuando lleguen los resultados

    const url = id
      ? `/api/check?id=${id}`
      : `/api/search?q=${encodeURIComponent(ytInput.trim())}${cleanMode ? '&safe=1' : ''}`
    fetchConReintentos(url)
      .then(async (r) => {
        if (requestId !== ytRequestRef.current) return // llegó tarde, ya no importa
        if (!r.ok) { setYtStatus('error'); return }
        const data = await r.json()
        if (id) {
          if (data.exists) {
            setYtStatus('exists')
            setYtFoundId(id)
            setYtFoundTitle(data.title ?? 'Video de YouTube')
            setYtFoundChannel(data.channel ?? null)
            setYtFoundThumbnail(data.thumbnail ?? null)
            setYtFoundDuration(data.durationSec ?? null)
          }
          else setYtStatus('missing')
          return
        }
        // Búsqueda por nombre: se muestran TODOS los resultados (en el
        // mismo orden que devuelve YouTube), no se elige uno solo
        // automáticamente — el usuario decide cuál agregar.
        const items: { id: string; title: string; channel?: string; thumbnail?: string; durationSec?: number | null }[] = data.items ?? []
        if (items.length > 0) { setYtStatus('exists'); setYtResults(items) }
        else setYtStatus('missing')
      })
      .catch(() => { if (requestId === ytRequestRef.current) setYtStatus('error') })
  }

  // Pegar un link y agregarlo NUNCA necesita la API — el id se saca
  // directo del link. El chequeo verde/rojo (buscar) es un extra
  // informativo cuando la API está disponible, no un requisito.
  const directId = extractYoutubeId(ytInput)
  const canAdd = ytStatus === 'exists' || !!directId

  const agregar = () => {
    const target = ytStatus === 'exists' && ytFoundId
      ? { id: ytFoundId, title: ytFoundTitle ?? 'Video de YouTube', channel: ytFoundChannel ?? undefined, thumbnail: ytFoundThumbnail ?? undefined, durationSec: ytFoundDuration }
      : directId ? { id: directId, title: 'Video de YouTube' } : null
    if (!target) return
    if (addTarget === 'list') {
      onAddToList(target.id, target.title, { channel: target.channel, thumbnail: target.thumbnail, durationSec: target.durationSec })
      setYtInput(''); setYtStatus('idle'); setYtFoundId(null); setYtFoundTitle(null); setYtFoundChannel(null); setYtFoundThumbnail(null); setYtFoundDuration(null)
      setJustAdded(target.id)
      setTimeout(() => setJustAdded((id) => (id === target.id ? null : id)), 1200)
      return
    }
    setPendingYt(target)
    setPickingDeck(true)
  }

  const elegirPlato = (deck: 1 | 2) => {
    if (pendingYt) { onLoadYoutube(pendingYt.id, pendingYt.title, deck, { channel: pendingYt.channel, thumbnail: pendingYt.thumbnail, durationSec: pendingYt.durationSec }); close() }
  }

  return (
    <div className="relative">
      <button type="button" onClick={() => setOpen((o) => !o)} className="flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[11px] font-semibold text-white" style={RAISED_BTN}>
        Agregar {open ? '▲' : '▼'}
      </button>
      {open && (
        <div className="absolute right-0 top-[calc(100%+6px)] z-20 w-64 overflow-hidden rounded-xl p-2.5 text-left" style={METAL_PANEL}>
          <MetalGrain />
          {!ytMode && !pickingDeck && !catalogMode ? (
            <div className="relative flex flex-col gap-1.5">
              <button type="button" onClick={() => setPickingDeck(true)} className="rounded-lg px-2.5 py-2 text-left text-[11px] font-semibold text-white/80 hover:text-white" style={RAISED_BTN}>
                Biblioteca — audio de tu Mac
              </button>
              <button type="button" onClick={() => setCatalogMode(true)} className="rounded-lg px-2.5 py-2 text-left text-[11px] font-semibold text-white/80 hover:text-white" style={RAISED_BTN}>
                Música de MABRIONA
              </button>
              <button type="button" onClick={() => { setAddTarget('deck'); setYtMode(true) }} className="rounded-lg px-2.5 py-2 text-left text-[11px] font-semibold text-white/80 hover:text-white" style={RAISED_BTN}>
                Buscar en YouTube
              </button>
              <button type="button" onClick={() => { setAddTarget('list'); setYtMode(true) }} className="rounded-lg px-2.5 py-2 text-left text-[11px] font-semibold text-white/80 hover:text-white" style={RAISED_BTN}>
                Agregar a la lista (MEZCLA)
              </button>
              {hasVideo && (
                <button type="button" onClick={() => { onRemoveVideo(); close() }} className="rounded-lg px-2.5 py-2 text-left text-[11px] font-semibold text-red-300 hover:text-red-200" style={RAISED_BTN}>
                  Quitar video actual
                </button>
              )}
            </div>
          ) : catalogMode ? (
            <div className="relative flex flex-col gap-1.5">
              <span className="px-1 text-[10px] font-bold text-white/40">Música de MABRIONA</span>
              <MusicCatalogPicker
                accountId={accountId}
                onLoadToDeck={(file, title, deck) => { onLoadFile(file, deck); void title; close() }}
                onAddToAutoMix={(file, title) => onAddCatalogToAutoMix(file, title)}
              />
              <button type="button" onClick={() => setCatalogMode(false)} className="text-[10px] text-white/30 underline decoration-white/20 underline-offset-2">← Volver</button>
            </div>
          ) : pickingDeck ? (
            <div className="relative flex flex-col gap-1.5">
              <span className="px-1 text-[10px] font-bold text-white/40">¿A qué plato lo agrego?</span>
              {pendingYt ? (
                ([1, 2] as const).map((deck) => (
                  <button key={deck} type="button" onClick={() => elegirPlato(deck)} className="rounded-lg px-2.5 py-2 text-left text-[11px] font-semibold text-white/80 hover:text-white" style={RAISED_BTN}>
                    Plato {deck}
                  </button>
                ))
              ) : (
                ([1, 2] as const).map((deck) => (
                  <label key={deck} className="flex cursor-pointer items-center gap-2 rounded-lg px-2.5 py-2 text-[11px] font-semibold text-white/80 hover:text-white" style={RAISED_BTN}>
                    Plato {deck}
                    <input
                      type="file"
                      accept="audio/*,video/*"
                      className="hidden"
                      onChange={(e) => {
                        const file = e.target.files?.[0]
                        if (file) { onLoadFile(file, deck); close() }
                        e.target.value = ''
                      }}
                    />
                  </label>
                ))
              )}
              <button type="button" onClick={() => { setPickingDeck(false); setPendingYt(null) }} className="text-[10px] text-white/30 underline decoration-white/20 underline-offset-2">← Volver</button>
            </div>
          ) : (
            <div className="relative flex flex-col gap-1.5">
              <span className="px-1 text-[10px] font-bold text-white/40">
                {addTarget === 'list' ? 'Se agrega a la lista (MEZCLA)' : 'Se agrega a un plato'}
              </span>
              <input
                type="text"
                value={ytInput}
                onChange={(e) => { setYtInput(e.target.value); setYtStatus('idle'); setYtFoundId(null); ytRequestRef.current += 1 }}
                onKeyDown={(e) => e.key === 'Enter' && buscar()}
                placeholder="Link de YouTube (o texto para buscar)…"
                autoFocus
                className="rounded-lg px-2.5 py-2 text-[11px] text-white placeholder:text-white/30 focus:outline-none"
                style={{ background: '#050608', boxShadow: 'inset 0 1px 3px rgba(0,0,0,0.7), inset 0 0 0 1px rgba(255,255,255,0.08)' }}
              />

              <div className="flex items-center gap-2">
                <button type="button" onClick={buscar} disabled={ytStatus === 'checking'} className="flex-1 rounded-lg px-2.5 py-2 text-[11px] font-bold text-white/70 disabled:opacity-50" style={RAISED_BTN}>
                  {ytStatus === 'checking' ? 'Buscando…' : 'Buscar'}
                </button>
                <span
                  className="h-3 w-3 shrink-0 rounded-full"
                  title={ytStatus === 'exists' ? 'El video existe' : ytStatus === 'missing' || ytStatus === 'error' ? 'No se encontró' : 'Sin buscar todavía'}
                  style={{
                    background: ytStatus === 'exists' ? '#22c55e' : ytStatus === 'missing' || ytStatus === 'error' ? '#ef4444' : 'rgba(255,255,255,0.15)',
                    boxShadow: ytStatus === 'exists' ? '0 0 8px #22c55e99' : ytStatus === 'missing' || ytStatus === 'error' ? '0 0 8px #ef444499' : 'none',
                    animation: ytStatus === 'checking' ? 'dj-spectrum-pulse 0.8s ease-in-out infinite' : 'none',
                  }}
                />
              </div>

              {ytStatus === 'exists' && ytFoundTitle && ytResults.length === 0 && <span className="truncate text-[10px] text-white/50">✓ {ytFoundTitle}</span>}
              {ytStatus === 'missing' && <span className="text-[10px] text-white/50">No encontramos ese video en YouTube</span>}
              {ytStatus === 'error' && <span className="text-[10px] text-white/50">No se pudo verificar (¿ya conectaste Vercel?)</span>}
              {justAdded && <span className="text-[10px] font-semibold" style={{ color: DECK_A }}>✓ Agregado a la lista</span>}

              {ytResults.length === 0 && (
                <button
                  type="button"
                  onClick={agregar}
                  disabled={!canAdd}
                  className="rounded-lg px-2.5 py-2 text-[11px] font-bold text-black disabled:opacity-30"
                  style={{ background: DECK_A }}
                >
                  {addTarget === 'list' ? 'Agregar a la lista' : 'Agregar'}
                </button>
              )}
              <button type="button" onClick={() => { addTarget === 'list' ? close() : setYtMode(false) }} className="text-[10px] text-white/30 underline decoration-white/20 underline-offset-2">
                {addTarget === 'list' ? 'Listo' : '← Volver'}
              </button>
            </div>
          )}
        </div>
      )}

      {/* Carrusel flotante de resultados — búsqueda por nombre trae varios videos, elegís cuál agregar. Tiene su propio buscador para encadenar otra búsqueda sin cerrarse. */}
      {carouselOpen && (
        <div className="fixed inset-0 z-30 flex items-center justify-center bg-black/70 p-6" onClick={close}>
          <div
            className="relative flex max-h-[75vh] w-full max-w-md flex-col overflow-hidden rounded-2xl p-4"
            style={METAL_PANEL}
            onClick={(e) => e.stopPropagation()}
          >
            <MetalGrain />
            <div className="relative mb-3 flex items-center justify-between">
              <span className="text-[11px] font-bold tracking-[0.1em] text-white/60">
                RESULTADOS DE YOUTUBE{addTarget === 'list' && <span className="ml-1.5 font-normal normal-case text-white/40">— tocá para sumar a la lista</span>}
              </span>
              <button type="button" onClick={close} className="rounded-full px-2 py-1 text-[10px] font-bold text-white/50" style={RAISED_BTN}>✕</button>
            </div>
            <div className="relative mb-3 flex items-center gap-2">
              <input
                type="text"
                value={ytInput}
                onChange={(e) => { setYtInput(e.target.value); ytRequestRef.current += 1 }}
                onKeyDown={(e) => e.key === 'Enter' && buscar()}
                placeholder="Buscar otro artista o canción…"
                className="min-w-0 flex-1 rounded-lg px-2.5 py-2 text-[11px] text-white placeholder:text-white/30 focus:outline-none"
                style={{ background: '#050608', boxShadow: 'inset 0 1px 3px rgba(0,0,0,0.7), inset 0 0 0 1px rgba(255,255,255,0.08)' }}
              />
              <button type="button" onClick={buscar} disabled={ytStatus === 'checking'} className="shrink-0 rounded-lg px-3 py-2 text-[11px] font-bold text-white/70 disabled:opacity-50" style={RAISED_BTN}>
                {ytStatus === 'checking' ? '…' : 'Buscar'}
              </button>
            </div>
            <div className="relative flex flex-col gap-2 overflow-y-auto pr-1">
              {ytStatus === 'checking' && ytResults.length === 0 && <span className="px-1 text-[10px] text-white/40">Buscando…</span>}
              {ytStatus === 'missing' && <span className="px-1 text-[10px] text-white/40">No encontramos nada con eso</span>}
              {ytStatus === 'error' && <span className="px-1 text-[10px] text-white/40">No se pudo buscar, probá de nuevo</span>}
              {ytResults.map((r) => (
                <div key={r.id} className="flex items-center gap-3 rounded-xl p-2 hover:brightness-125" style={RAISED_BTN}>
                  <button type="button" onClick={() => elegirResultado(r)} className="flex min-w-0 flex-1 items-center gap-3 text-left">
                    {r.thumbnail ? (
                      <img src={r.thumbnail} alt="" className="h-12 w-20 shrink-0 rounded-md object-cover" />
                    ) : (
                      <div className="h-12 w-20 shrink-0 rounded-md bg-black/40" />
                    )}
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[11px] font-semibold text-white">{r.title}</div>
                      {r.channel && <div className="truncate text-[10px] text-white/40">{r.channel}</div>}
                    </div>
                  </button>
                  {justAdded === r.id ? (
                    <span className="shrink-0 text-[10px] font-semibold" style={{ color: DECK_A }}>✓ Agregado</span>
                  ) : (
                    // Siempre disponible ahí mismo, sin importar si entraste buscando "para un plato" o "para la lista" — un toque y suma a la lista, aparte de la acción principal de la fila.
                    <button
                      type="button"
                      onClick={() => {
                        onAddToList(r.id, r.title)
                        setJustAdded(r.id)
                        setTimeout(() => setJustAdded((id) => (id === r.id ? null : id)), 1200)
                      }}
                      className="shrink-0 rounded-lg px-2 py-1.5 text-[10px] font-bold text-white/60 hover:text-white"
                      style={RAISED_BTN}
                    >
                      + Lista
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}


/** Forma de onda real (no decorativa) a partir de los picos analizados por el motor de audio del deck. */
/**
 * Espectro real: mientras suena una pista con audio real (Biblioteca),
 * son barras de frecuencia en vivo (FFT real vía AnalyserNode, no una
 * animación decorativa) — laten con el ritmo/volumen/frecuencias de
 * verdad. En pausa muestra la forma de onda estática ya analizada.
 * YouTube no tiene audio accesible para analizar (limitación real del
 * navegador, no de la app) — queda claro con su propio mensaje en vez
 * de fingir un análisis que no existe.
 */
let neonWaveGradId = 0

/** Onda de espectro real, línea suave con brillo neón — reemplaza las barras clásicas por un visualizador tipo "analizador de audio de próxima generación". Los valores son reales (FFT del AnalyserNode), solo cambia cómo se dibujan. */
function NeonWaveSpectrum({ values, color }: { values: number[]; color: string }) {
  const gradId = useMemo(() => `dj-wave-grad-${neonWaveGradId++}`, [])
  const w = 300
  const h = 40
  const mid = h / 2
  const step = w / (values.length - 1)
  const topPts = values.map((v, i) => ({ x: i * step, y: mid - v * (mid - 3) }))
  const botPts = values.map((v, i) => ({ x: i * step, y: mid + v * (mid - 3) }))

  const smooth = (pts: { x: number; y: number }[]) => {
    let d = `M ${pts[0].x.toFixed(1)} ${pts[0].y.toFixed(1)}`
    for (let i = 0; i < pts.length - 1; i++) {
      const mx = ((pts[i].x + pts[i + 1].x) / 2).toFixed(1)
      const my = ((pts[i].y + pts[i + 1].y) / 2).toFixed(1)
      d += ` Q ${pts[i].x.toFixed(1)} ${pts[i].y.toFixed(1)} ${mx} ${my}`
    }
    const last = pts[pts.length - 1]
    d += ` L ${last.x.toFixed(1)} ${last.y.toFixed(1)}`
    return d
  }

  const topLine = smooth(topPts)
  const botLine = smooth(botPts)
  const fillPath = `${topLine} L ${w} ${mid} L 0 ${mid} Z`
  const fillPathBot = `${botLine} L ${w} ${mid} L 0 ${mid} Z`

  return (
    <div className="relative h-10 w-full overflow-hidden">
      <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" className="h-full w-full">
        <defs>
          <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity="0.85" />
            <stop offset="100%" stopColor={color} stopOpacity="0" />
          </linearGradient>
        </defs>
        <line x1="0" y1={mid} x2={w} y2={mid} stroke={color} strokeOpacity="0.15" strokeWidth="1" />
        <path d={fillPath} fill={`url(#${gradId})`} />
        <path d={fillPathBot} fill={`url(#${gradId})`} />
        <path d={topLine} fill="none" stroke={color} strokeWidth="1.6" strokeLinecap="round" style={{ filter: `drop-shadow(0 0 3px ${color}) drop-shadow(0 0 7px ${color}99)` }} />
        <path d={botLine} fill="none" stroke={color} strokeWidth="1.6" strokeLinecap="round" style={{ filter: `drop-shadow(0 0 3px ${color}) drop-shadow(0 0 7px ${color}99)` }} />
        <path d={topLine} fill="none" stroke="#fff" strokeOpacity="0.5" strokeWidth="0.6" />
      </svg>
    </div>
  )
}

function RealWaveform({ engine, color, detail = 'full', mono = false }: { engine: DeckEngine; color: string; detail?: 'full' | 'simple'; mono?: boolean }) {
  const progress = engine.duration > 0 ? engine.currentTime / engine.duration : 0
  const activeColor = mono ? '#5fe3ff' : color

  if (engine.isPlaying && engine.spectrum.length > 0) {
    return <NeonWaveSpectrum values={engine.spectrum} color={activeColor} />
  }

  if (!engine.peaks) {
    // YouTube no tiene audio real que analizar (límite del navegador,
    // no de la app) — mientras suena igual se ve un espectro con vida
    // en vez de dejar la zona vacía; queda quieto/oculto si no hay
    // nada sonando, como se pidió.
    if (engine.trackName && engine.isPlaying) {
      return <FakeMovingSpectrum color={activeColor} />
    }
    return (
      <div className="flex h-10 items-center justify-center text-[10px] text-white/25">
        {engine.trackName ? 'Sin datos de audio (YouTube)' : 'Sin pista analizada'}
      </div>
    )
  }
  const peaks = detail === 'simple' ? engine.peaks.filter((_, i) => i % 4 === 0) : engine.peaks
  return (
    <div className="flex h-10 items-end gap-px">
      {peaks.map((h, i) => (
        <span
          key={i}
          className="flex-1 rounded-[1px]"
          style={{ height: `${8 + h * 92}%`, background: i / peaks.length <= progress ? activeColor : 'rgba(255,255,255,0.15)' }}
        />
      ))}
    </div>
  )
}

/**
 * Solo para YouTube, mientras el video está sonando: el navegador no
 * deja leer el audio real de un iframe de otro sitio, así que esto NO
 * es un análisis (no hay uno posible) — es animación simulada, para
 * que la zona no se vea muerta mientras algo sí está sonando de
 * verdad arriba. Se apaga apenas se pausa.
 */
function FakeMovingSpectrum({ color }: { color: string }) {
  return (
    <div className="flex h-10 items-end gap-px">
      {Array.from({ length: 28 }, (_, i) => (
        <span
          key={i}
          className="dj-spectrum-bar flex-1 origin-bottom rounded-[1px]"
          style={
            {
              height: `${20 + ((i * 37) % 70)}%`,
              background: color,
              opacity: 0.7,
              '--dj-peak': (1.1 + ((i * 13) % 30) / 100).toFixed(2),
              animation: `dj-spectrum-pulse ${(0.4 + ((i * 7) % 50) / 100).toFixed(2)}s ease-in-out infinite`,
              animationDelay: `${-((i * 11) % 100) / 100}s`,
            } as React.CSSProperties
          }
        />
      ))}
    </div>
  )
}

/** Vista PROCESS: análisis real del motor por deck — BPM detectado, hot cues guardados y forma de onda completa. */
function ProcessView({ deckA, deckB, waveformDetail, waveformMono }: { deckA: DeckEngine; deckB: DeckEngine; waveformDetail: 'full' | 'simple'; waveformMono: boolean }) {
  const decks = [{ label: 'DECK 1', engine: deckA, color: DECK_A }, { label: 'DECK 2', engine: deckB, color: DECK_B }]
  return (
    <div className="grid grid-cols-2 gap-4 text-left">
      {decks.map(({ label, engine, color }) => {
        const cues = engine.hotCues.map((c, i) => ({ ...c, i })).filter((c) => c.time != null)
        return (
          <div key={label} className="flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-bold tracking-[0.12em]" style={{ color }}>{label}</span>
              <span className="max-w-[10rem] truncate text-[10px] text-white/40">{engine.trackName ?? 'Sin pista'}</span>
            </div>
            <div className="flex items-center gap-4 text-[10px] text-white/50">
              <span>BPM: <b className="font-mono text-white/80">{engine.bpm ? engine.bpm.toFixed(1) : '--.-'}</b></span>
              <span>Tiempo: <b className="font-mono text-white/80">{fmtTime(engine.currentTime)} / {fmtTime(engine.duration)}</b></span>
            </div>
            <RealWaveform engine={engine} color={color} detail={waveformDetail} mono={waveformMono} />
            <div>
              <div className="mb-1 text-[9px] font-bold tracking-[0.1em] text-white/30">HOT CUES GUARDADOS</div>
              {cues.length === 0 ? (
                <div className="text-[10px] text-white/25">Ninguno todavía</div>
              ) : (
                <div className="flex flex-wrap gap-1.5">
                  {cues.map((c) => (
                    <span key={c.i} className="rounded px-1.5 py-0.5 font-mono text-[9px] font-bold" style={{ color, background: `${color}1a`, border: `1px solid ${color}55` }}>
                      #{c.i + 1} · {fmtTime(c.time!)}
                    </span>
                  ))}
                </div>
              )}
            </div>
          </div>
        )
      })}
    </div>
  )
}

/** Pastilla corta (ancho de su contenido, no una barra que ocupa todo el ancho) — mismo tamaño que la referencia Liquid Glass ("Switch", "Select"). */
function ToggleRow({ label, active, onClick, color }: { label: string; active: boolean; onClick: () => void; color: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex w-fit items-center gap-2.5 whitespace-nowrap rounded-full px-4 py-2 text-[10px] font-bold"
      style={active ? raisedActive(color) : { ...RAISED_BTN, color: 'rgba(255,255,255,0.5)' }}
    >
      <span>{label}</span>
      <span>{active ? 'ON' : 'OFF'}</span>
    </button>
  )
}

/** Vista DISPLAY: ajustes reales de la pantalla — brillo, densidad de la forma de onda y modo de color. */
/** Vista MENU/CONFIG: ajustes reales del controlador — quantize, sensibilidad del jog, pantalla/forma de onda, y administración. */
function MenuView({
  deckA, deckB, jogSensA, jogSensB, onJogSensA, onJogSensB, onClearQueue, onClearHistory,
  brightness, onBrightness, waveformDetail, onWaveformDetail, waveformMono, onWaveformMono,
  schedule, onScheduleChange,
}: {
  deckA: DeckEngine
  deckB: DeckEngine
  jogSensA: number
  jogSensB: number
  onJogSensA: (v: number) => void
  onJogSensB: (v: number) => void
  onClearQueue: () => void
  onClearHistory: () => void
  brightness: number
  onBrightness: (v: number) => void
  waveformDetail: 'full' | 'simple'
  onWaveformDetail: (v: 'full' | 'simple') => void
  waveformMono: boolean
  onWaveformMono: () => void
  schedule: ScheduleConfig
  onScheduleChange: (patch: Partial<ScheduleConfig>) => void
}) {
  const rows = [
    { label: 'DECK 1', engine: deckA, color: DECK_A, sens: jogSensA, onSens: onJogSensA },
    { label: 'DECK 2', engine: deckB, color: DECK_B, sens: jogSensB, onSens: onJogSensB },
  ]
  return (
    <div className="absolute inset-0 flex flex-col gap-4 overflow-y-auto p-5 text-left">
      <div className="grid grid-cols-2 gap-4">
        {rows.map(({ label, engine, color, sens, onSens }) => (
          <div key={label} className="flex flex-col gap-2.5">
            <span className="text-[10px] font-bold tracking-[0.12em]" style={{ color }}>{label}</span>
            <ToggleRow label="Quantize" active={engine.quantize} onClick={() => engine.setQuantize(!engine.quantize)} color={color} />
            <div className="inline-flex w-fit items-center gap-3 whitespace-nowrap rounded-full px-4 py-2" style={RAISED_BTN}>
              <span className="text-[10px] font-bold text-white/50">Jog</span>
              <input type="range" min={0.4} max={2} step={0.05} value={sens} onChange={(e) => onSens(Number(e.target.value))} className="w-16" style={{ accentColor: color }} />
              <span className="w-8 text-right font-mono text-[10px] text-white/50">{sens.toFixed(2)}x</span>
            </div>
          </div>
        ))}
      </div>
      <div className="flex flex-col gap-2 border-t border-white/[0.06] pt-3">
        <span className="text-[10px] font-bold tracking-[0.12em] text-white/50">PANTALLA</span>
        <div className="inline-flex w-fit items-center gap-3 whitespace-nowrap rounded-full px-4 py-2" style={RAISED_BTN}>
          <span className="text-[10px] font-bold text-white/50">Brillo</span>
          <input type="range" min={0.6} max={1.4} step={0.02} value={brightness} onChange={(e) => onBrightness(Number(e.target.value))} className="w-20" style={{ accentColor: DECK_A }} />
          <span className="w-10 text-right font-mono text-[10px] text-white/50">{Math.round(brightness * 100)}%</span>
        </div>
        <ToggleRow label="Forma de onda: detalle completo" active={waveformDetail === 'full'} onClick={() => onWaveformDetail(waveformDetail === 'full' ? 'simple' : 'full')} color={DECK_A} />
        <ToggleRow label="Color por deck (vs. monocromo)" active={!waveformMono} onClick={onWaveformMono} color={DECK_A} />
      </div>
      <div className="flex flex-col gap-2 border-t border-white/[0.06] pt-3">
        <span className="text-[10px] font-bold tracking-[0.12em] text-white/50">PROGRAMACIÓN</span>
        <ToggleRow label="Arranque automático" active={schedule.enabled} onClick={() => onScheduleChange({ enabled: !schedule.enabled })} color={DECK_A} />
        <div className="inline-flex w-fit items-center gap-3 whitespace-nowrap rounded-full px-4 py-2" style={RAISED_BTN}>
          <span className="text-[10px] font-bold text-white/50">Hora</span>
          <input
            type="time"
            value={schedule.time}
            onChange={(e) => onScheduleChange({ time: e.target.value })}
            className="rounded-md px-2 py-1 text-[11px] text-white focus:outline-none"
            style={{ background: '#050608', boxShadow: 'inset 0 1px 3px rgba(0,0,0,0.7), inset 0 0 0 1px rgba(255,255,255,0.08)' }}
          />
        </div>
        <div className="flex flex-wrap gap-1.5">
          {WEEKDAY_LABELS.map((label, day) => (
            <button
              key={day}
              type="button"
              onClick={() => onScheduleChange({ days: schedule.days.includes(day) ? schedule.days.filter((d) => d !== day) : [...schedule.days, day] })}
              className="rounded-lg px-2.5 py-1.5 text-[10px] font-bold"
              style={schedule.days.includes(day) ? raisedActive(DECK_A) : { ...RAISED_BTN, color: 'rgba(255,255,255,0.4)' }}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap gap-1.5">
          {(['mezcla', 'lista'] as const).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => onScheduleChange({ target: t })}
              className="rounded-full px-4 py-2 text-[10px] font-bold"
              style={schedule.target === t ? raisedActive(DECK_A) : { ...RAISED_BTN, color: 'rgba(255,255,255,0.5)' }}
            >
              {t === 'mezcla' ? 'Mezcla Automática' : 'Lista de canciones'}
            </button>
          ))}
        </div>
        <span className="text-[9.5px] text-white/25">
          A la hora elegida, arranca sola — Mezcla Automática necesita al menos 2 canciones cargadas en la Biblioteca, Lista de canciones necesita la lista de YouTube ya armada.
        </span>
      </div>
      <div className="flex flex-col gap-2 border-t border-white/[0.06] pt-3">
        <span className="text-[10px] font-bold tracking-[0.12em] text-white/50">ADMINISTRACIÓN</span>
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={onClearQueue} className="rounded-lg px-3 py-2 text-[10px] font-bold text-red-300" style={RAISED_BTN}>Vaciar cola de Mezcla Automática</button>
          <button type="button" onClick={onClearHistory} className="rounded-lg px-3 py-2 text-[10px] font-bold text-red-300" style={RAISED_BTN}>Vaciar Historial</button>
        </div>
      </div>
      <div className="mt-1 text-[9px] text-white/25">MABRIONA DJ IA — motor Web Audio real, versión de desarrollo</div>
    </div>
  )
}

interface AutoMixTrack { key: string; name: string; bpm: number | null }

/**
 * Vista PLAYLIST: Mezcla Automática — cola de pistas de la Biblioteca
 * (archivos de audio reales, único origen con BPM real detectable) que
 * se van mezclando solas: la que suena y la próxima se cargan cada una
 * en un plato real, el plato que entra ajusta su tempo al de la que
 * está sonando (`syncTo`, ya existente en el motor) y el crossfader
 * real del mezclador (`audio.setCrossfaderValue`, curva equal-power)
 * hace el barrido de volumen entre las dos — sin cortes. YouTube queda
 * afuera a propósito: el navegador no tiene acceso al audio crudo del
 * iframe, así que no hay forma real de detectarle el ritmo (mismo
 * límite que ya documenta el resto de la pantalla para YouTube).
 */
function AutoMixView({
  queue, currentIndex, running, transitioning, status,
  onAddFiles, onRemove, onMove, onClear, onStart, onStop, onSkip,
  genreMix, onUpdateGenreRow, onAddGenreRow, onRemoveGenreRow, onGenerateGenreQueue, genreGenerating, onResetGenres,
  ytAutoQueue, ytAutoIndex, ytAutoOn, ytAutoStatus, onStartYtAuto, onStopYtAuto, onAdvanceYtAuto,
  onPlayYtAuto, onMoveYtAuto, onRemoveYtAuto,
}: {
  queue: AutoMixTrack[]
  currentIndex: number
  running: boolean
  transitioning: boolean
  status: string
  onAddFiles: (files: FileList) => void
  onRemove: (i: number) => void
  onMove: (i: number, dir: -1 | 1) => void
  onClear: () => void
  onStart: () => void
  onStop: () => void
  onSkip: () => void
  genreMix: GenreMixRow[]
  onUpdateGenreRow: (i: number, patch: Partial<GenreMixRow>) => void
  onAddGenreRow: () => void
  onRemoveGenreRow: (i: number) => void
  onGenerateGenreQueue: () => void
  genreGenerating: boolean
  onResetGenres: () => void
  ytAutoQueue: YtQueueTrack[]
  ytAutoIndex: number
  ytAutoOn: boolean
  ytAutoStatus: string
  onStartYtAuto: () => void
  onStopYtAuto: () => void
  onAdvanceYtAuto: () => void
  onPlayYtAuto: (i: number) => void
  onMoveYtAuto: (i: number, dir: -1 | 1) => void
  onRemoveYtAuto: (i: number) => void
}) {
  return (
    <div className="absolute inset-0 flex flex-col overflow-y-auto p-4 text-left">
      <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
        <span className="text-[10px] font-bold tracking-[0.12em] text-white/50">
          MEZCLA AUTOMÁTICA{queue.length > 0 && <span className="ml-1 font-normal text-white/30">({queue.length})</span>}
        </span>
      </div>
      <p className="mb-3 text-[9px] text-white/25">Mezcla de verdad: crossfade real + ajusta el tempo de la que entra al BPM de la que suena.</p>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <label className="cursor-pointer rounded-full px-2.5 py-1 text-[10px] font-bold text-white/80" style={RAISED_BTN}>
            + Agregar audio
            <input
              type="file"
              accept="audio/*"
              multiple
              className="hidden"
              onChange={(e) => { if (e.target.files?.length) onAddFiles(e.target.files); e.target.value = '' }}
            />
          </label>
          {queue.length > 0 && !running && (
            <button type="button" onClick={onClear} className="rounded-full px-2.5 py-1 text-[10px] font-bold text-red-300" style={RAISED_BTN}>Vaciar</button>
          )}
        </div>
      </div>

      {queue.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-1.5 text-white/25">
          <span className="text-[11px] uppercase tracking-wide">Todavía no hay canciones cargadas</span>
          <span className="max-w-[260px] text-center text-[10px] text-white/20">
            Tocá "+ Agregar audio" y elegí al menos 2 archivos — la Mezcla Automática detecta el ritmo real de cada uno y las va uniendo sola, sin cortes
          </span>
        </div>
      ) : (
        <div className="flex flex-wrap gap-1.5">
          {queue.map((t, i) => (
            <div key={`${t.key}-${i}`} className="flex w-72 max-w-full items-center gap-3 rounded-xl p-2.5" style={running && i === currentIndex ? raisedActive(DECK_A) : RAISED_BTN}>
              <span className="flex h-9 w-9 shrink-0 items-center justify-center text-white/40">
                {running && i === currentIndex ? <IconPause className="h-4 w-4" /> : <IconPlay className="h-4 w-4 opacity-30" />}
              </span>
              <div className="min-w-0 flex-1">
                <div className="truncate text-[11px] font-semibold text-white/80">{i + 1}. {t.name}</div>
                <div className="font-mono text-[9.5px] text-white/30">{t.bpm ? `${t.bpm.toFixed(1)} BPM` : 'BPM se detecta al sonar'}</div>
              </div>
              {!running && (
                <>
                  <button type="button" onClick={() => onMove(i, -1)} disabled={i === 0} className="text-white/30 hover:text-white disabled:opacity-20" title="Subir">▲</button>
                  <button type="button" onClick={() => onMove(i, 1)} disabled={i === queue.length - 1} className="text-white/30 hover:text-white disabled:opacity-20" title="Bajar">▼</button>
                  <button type="button" onClick={() => onRemove(i)} className="text-white/30 hover:text-red-300" title="Quitar">✕</button>
                </>
              )}
            </div>
          ))}
        </div>
      )}

      <div className="mt-4 flex flex-col gap-2 rounded-xl border border-white/[0.06] p-3">
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={onStart}
            disabled={running || queue.length < 2}
            className="rounded-lg px-3 py-2 text-[11px] font-bold text-black disabled:opacity-30"
            style={{ background: DECK_A }}
          >
            ▶ Iniciar
          </button>
          <button
            type="button"
            onClick={onStop}
            disabled={!running}
            className="rounded-lg px-3 py-2 text-[11px] font-bold text-white/70 disabled:opacity-30"
            style={RAISED_BTN}
          >
            ⏹ Parar
          </button>
          <button
            type="button"
            onClick={onSkip}
            disabled={!running || transitioning || queue.length < 2}
            className="rounded-lg px-3 py-2 text-[11px] font-bold text-white/70 disabled:opacity-30"
            style={RAISED_BTN}
          >
            ⏭ Cambiar canción
          </button>
          {status && <span className="text-[10px] text-white/40">{status}</span>}
        </div>
        <span className="text-[9.5px] text-white/25">
          Solo con audio de la Biblioteca (archivos reales) — YouTube no tiene el audio accesible para detectarle el ritmo de verdad.
        </span>
      </div>

      <GenreAutoView
        mix={genreMix} onUpdateRow={onUpdateGenreRow} onAddRow={onAddGenreRow} onRemoveRow={onRemoveGenreRow}
        onGenerate={onGenerateGenreQueue} generating={genreGenerating} onReset={onResetGenres}
      />
      <AddedListView
        queue={ytAutoQueue} queueIndex={ytAutoIndex} running={ytAutoOn} status={ytAutoStatus}
        onStart={onStartYtAuto} onStop={onStopYtAuto} onAdvance={onAdvanceYtAuto}
        onPlay={onPlayYtAuto} onMove={onMoveYtAuto} onRemove={onRemoveYtAuto}
      />
    </div>
  )
}

interface GenreMixRow { genre: string; count: number }
const DEFAULT_GENRE_MIX: GenreMixRow[] = [
  { genre: 'bachata', count: 5 },
  { genre: 'reggaeton dembow', count: 3 },
  { genre: 'salsa', count: 3 },
  { genre: 'merengue orquesta', count: 3 },
  { genre: 'merengue típico', count: 4 },
]
interface YtQueueTrack { id: string; title: string }

/**
 * Lista Automática por Género — a diferencia de la Mezcla Automática
 * (Biblioteca, con BPM/tempo real), esta busca de verdad en YouTube
 * (mismo `/api/search` del buscador) la cantidad pedida de cada
 * género, arma una lista mezclada y la pone a sonar sola, una detrás
 * de otra (avanza real cuando el video que suena está por terminar —
 * sin beatmatching, YouTube no tiene el audio accesible para eso,
 * mismo límite documentado en el resto de la pantalla).
 */
function GenreAutoView({
  mix, onUpdateRow, onAddRow, onRemoveRow, onGenerate, generating, onReset,
}: {
  mix: GenreMixRow[]
  onUpdateRow: (i: number, patch: Partial<GenreMixRow>) => void
  onAddRow: () => void
  onRemoveRow: (i: number) => void
  onGenerate: () => void
  generating: boolean
  onReset: () => void
}) {
  return (
    <div className="mt-4 flex flex-col gap-2.5 rounded-xl border border-white/[0.06] p-3">
      <span className="text-[10px] font-bold tracking-[0.12em] text-white/50">LISTA AUTOMÁTICA — YOUTUBE POR GÉNERO</span>
      <span className="text-[9.5px] text-white/25">
        Elegí cuántas canciones de cada género querés (ej. 5 bachata, 3 dembow, 3 salsa) y generá la lista — busca de verdad en YouTube, arma el orden y se pone a sonar sola. Pasa de una canción a otra por corte (sin crossfade ni beatmatch) — para mezcla real con transición, usá MEZCLA AUTOMÁTICA con audio de tu computadora.
      </span>
      {mix.length === 0 && (
        <button type="button" onClick={onReset} className="w-fit rounded-full px-4 py-2 text-[10px] font-bold" style={raisedActive(DECK_A)}>
          ↺ Restaurar géneros por defecto
        </button>
      )}
      <div className="flex flex-wrap gap-1.5">
        {mix.map((row, i) => (
          <div key={i} className="flex items-center gap-2 rounded-lg p-1.5" style={RAISED_BTN}>
            <input
              type="text"
              value={row.genre}
              onChange={(e) => onUpdateRow(i, { genre: e.target.value })}
              placeholder="Género (ej. bachata)"
              className="w-32 rounded-md px-2.5 py-1.5 text-[11px] text-white placeholder:text-white/30 focus:outline-none"
              style={{ background: '#050608', boxShadow: 'inset 0 1px 3px rgba(0,0,0,0.7), inset 0 0 0 1px rgba(255,255,255,0.08)' }}
            />
            <input
              type="number"
              min={0}
              max={20}
              value={row.count}
              onChange={(e) => onUpdateRow(i, { count: Math.max(0, Math.min(20, Number(e.target.value))) })}
              className="w-14 rounded-lg px-2 py-1.5 text-center text-[11px] text-white focus:outline-none"
              style={{ background: '#050608', boxShadow: 'inset 0 1px 3px rgba(0,0,0,0.7), inset 0 0 0 1px rgba(255,255,255,0.08)' }}
            />
            <button type="button" onClick={() => onRemoveRow(i)} className="text-white/30 hover:text-red-300">✕</button>
          </div>
        ))}
        <button type="button" onClick={onAddRow} className="self-start rounded-lg px-2.5 py-1 text-[10px] font-bold text-white/50" style={RAISED_BTN}>+ Género</button>
      </div>
      <button
        type="button"
        onClick={onGenerate}
        disabled={generating || mix.every((r) => !r.genre.trim() || r.count <= 0)}
        className="self-start rounded-lg px-3 py-2 text-[11px] font-bold text-black disabled:opacity-30"
        style={{ background: DECK_A }}
      >
        {generating ? 'Generando…' : '🎲 Generar lista'}
      </button>
    </div>
  )
}

/**
 * Lista aparte — separada del generador por género a propósito: acá
 * viven TODAS las canciones agregadas (generadas por género o sumadas
 * a mano con "+ Lista" desde el buscador), en una caja propia, con
 * reordenar/quitar/reproducir real por canción. No comparte espacio
 * con los controles de generación de arriba.
 */
function AddedListView({
  queue, queueIndex, running, status, onStart, onStop, onAdvance, onPlay, onMove, onRemove,
}: {
  queue: YtQueueTrack[]
  queueIndex: number
  running: boolean
  status: string
  onStart: () => void
  onStop: () => void
  onAdvance: () => void
  onPlay: (i: number) => void
  onMove: (i: number, dir: -1 | 1) => void
  onRemove: (i: number) => void
}) {
  return (
    <div className="mt-4 flex flex-col gap-2.5 rounded-xl border border-white/[0.06] p-3">
      <span className="text-[10px] font-bold tracking-[0.12em] text-white/50">
        LISTA DE CANCIONES AGREGADAS{queue.length > 0 && <span className="ml-1 font-normal text-white/30">({queue.length})</span>}
      </span>
      <span className="text-[9px] text-white/25">Pasa de una a otra por corte, sin crossfade ni beatmatch (eso es solo en MEZCLA AUTOMÁTICA).</span>
      {queue.length === 0 ? (
        <span className="text-[9.5px] text-white/25">
          Todavía no agregaste ninguna — generá una lista por género arriba, o buscá y tocá "+ Lista" para sumarlas una por una. Acá aparecen todas, y podés moverlas a donde quieras.
        </span>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" onClick={onStart} disabled={running} className="rounded-lg px-3 py-2 text-[11px] font-bold text-black disabled:opacity-30" style={{ background: DECK_A }}>▶ Iniciar</button>
            <button type="button" onClick={onStop} disabled={!running} className="rounded-lg px-3 py-2 text-[11px] font-bold text-white/70 disabled:opacity-30" style={RAISED_BTN}>⏹ Parar</button>
            <button type="button" onClick={onAdvance} disabled={!running} className="rounded-lg px-3 py-2 text-[11px] font-bold text-white/70 disabled:opacity-30" style={RAISED_BTN}>⏭ Siguiente</button>
            {status && <span className="text-[10px] text-white/40">{status}</span>}
          </div>
          <div className="flex flex-wrap gap-2">
            {queue.map((t, i) => (
              <div key={`${t.id}-${i}`} className="flex w-36 max-w-full flex-col gap-1.5 rounded-lg p-2" style={running && i === queueIndex ? raisedActive(DECK_A) : RAISED_BTN}>
                <img src={`https://i.ytimg.com/vi/${t.id}/mqdefault.jpg`} alt="" className="h-32 w-full rounded-md object-cover" loading="lazy" />
                <span className="truncate text-[10.5px] font-semibold text-white/80">{i + 1}. {t.title}</span>
                <div className="flex items-center justify-between">
                  <button type="button" onClick={() => onPlay(i)} className="shrink-0 text-white/60 hover:text-white" title="Reproducir esta canción">
                    {running && i === queueIndex ? <IconPause className="h-3.5 w-3.5" /> : <IconPlay className="h-3.5 w-3.5" />}
                  </button>
                  <div className="flex items-center gap-1.5">
                    <button type="button" onClick={() => onMove(i, -1)} disabled={i === 0} className="text-white/30 hover:text-white disabled:opacity-20" title="Subir">▲</button>
                    <button type="button" onClick={() => onMove(i, 1)} disabled={i === queue.length - 1} className="text-white/30 hover:text-white disabled:opacity-20" title="Bajar">▼</button>
                    <button type="button" onClick={() => onRemove(i)} className="text-white/30 hover:text-red-300" title="Quitar de la lista">✕</button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  )
}

/**
 * Vista RESUMEN: estadísticas reales del negocio (calculadas del
 * Historial de verdad, no números inventados) arriba, y el detalle
 * técnico de cada plato (BPM, forma de onda, hot cues) abajo — lo que
 * antes era la pestaña PROCESS completa, ahora en contexto.
 */
function SummaryView({ history, deckA, deckB, waveformDetail, waveformMono }: {
  history: { name: string; at: number }[]
  deckA: DeckEngine
  deckB: DeckEngine
  waveformDetail: 'full' | 'simple'
  waveformMono: boolean
}) {
  const today = new Date().toDateString()
  const playedToday = history.filter((h) => new Date(h.at).toDateString() === today)
  const counts = new Map<string, number>()
  for (const h of history) counts.set(h.name, (counts.get(h.name) ?? 0) + 1)
  const topSong = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]
  const hourCounts = new Map<number, number>()
  for (const h of history) { const hr = new Date(h.at).getHours(); hourCounts.set(hr, (hourCounts.get(hr) ?? 0) + 1) }
  const topHour = [...hourCounts.entries()].sort((a, b) => b[1] - a[1])[0]

  const stats = [
    { label: 'Canciones hoy', value: String(playedToday.length) },
    { label: 'Más repetida', value: topSong ? `${topSong[0]} (${topSong[1]}x)` : '—' },
    { label: 'Hora con más actividad', value: topHour ? `${topHour[0]}:00 hs` : '—' },
  ]

  return (
    <div className="absolute inset-0 flex flex-col gap-3 overflow-y-auto p-4 text-left">
      <span className="text-[10px] font-bold tracking-[0.12em] text-white/50">RESUMEN DEL DÍA</span>
      <div className="flex flex-wrap gap-2.5">
        {stats.map((s) => (
          <div key={s.label} className="w-72 max-w-full rounded-lg px-3 py-3.5" style={RAISED_BTN}>
            <div className="truncate text-[12px] font-bold text-white">{s.value}</div>
            <div className="text-[9px] text-white/40">{s.label}</div>
          </div>
        ))}
      </div>
      {history.length === 0 && (
        <span className="text-[9.5px] text-white/25">Todavía no hay datos — en cuanto suene la primera canción, estos números se llenan solos.</span>
      )}
      <div className="mt-1 border-t border-white/[0.06] pt-3">
        <ProcessView deckA={deckA} deckB={deckB} waveformDetail={waveformDetail} waveformMono={waveformMono} />
      </div>
    </div>
  )
}

/** Vista AYUDA: guía rápida en palabras simples de cada función de DJ IA — pantalla propia, no un tooltip que se pierde. */
function HelpView() {
  const items = [
    { title: 'Cargar una canción', body: 'Botón "Agregar ▼" arriba a la derecha del video: elegí Biblioteca (un archivo de tu computadora) o Buscar en YouTube, y decidí a qué plato va.' },
    { title: 'Mezclar dos canciones a mano', body: 'Con una canción en cada plato, movés el Crossfader (la barra A...B del centro) para pasar de una a la otra vos mismo.' },
    { title: 'Mezcla Automática', body: 'Pestaña MEZCLA: subí 2 o más canciones de tu computadora y tocá ▶ Iniciar — se van mezclando solas, sin que hagas nada más.' },
    { title: 'Asistente DJ IA', body: 'Botón "○ Activar DJ IA" arriba de los platos: prende Modo energía (qué tan movida es la mezcla), Modo negocio (música limpia) y Volumen automático.' },
    { title: 'Historial', body: 'Pestaña HISTORIAL: lista de todo lo que sonó de verdad, con la hora — se llena sola.' },
    { title: 'Biblioteca', body: 'Pestaña BIBLIOTECA: cada video de YouTube que agregás a un plato o a la lista queda guardado ahí solo (título, artista, miniatura, duración) — nunca el video en sí. Podés buscar, marcar favoritos, armar playlists y cargar cualquiera de nuevo con un botón.' },
    { title: 'Música Local', body: 'Pestaña MÚSICA LOCAL: importá archivos de audio de a uno, en lote, o una carpeta entera desde tu computadora — quedan guardados en tu biblioteca (no se suben a ningún lado). Duración, BPM y forma de onda son reales (mismo análisis que usan los platos). Key, energía y compatibilidad todavía no existen — "Listo" significa solo que BPM/forma de onda están disponibles.' },
    { title: 'Lista y Transmisión en vivo', body: 'Arriba a la derecha de esa misma barra: "🎵 Lista" te lleva directo a la lista de canciones agregadas sin buscarla, y "🔴 Transmisión en vivo" solo marca la sesión como en vivo dentro de la app (para vos y para las métricas) — no transmite audio ni video a ningún lado, no es un streaming real.' },
    { title: 'Anuncios de YouTube', body: 'Los videos de YouTube en Plato 1/Plato 2 se reproducen con el reproductor oficial de YouTube — si YouTube decide mostrar un anuncio en un video, va a aparecer igual que en youtube.com. No existe ninguna forma oficial de quitarlo desde una app externa como MABRIONA.' },
  ]
  return (
    <div className="absolute inset-0 flex flex-col gap-2.5 overflow-y-auto p-4 text-left">
      <span className="text-[10px] font-bold tracking-[0.12em] text-white/50">AYUDA — CÓMO USAR DJ IA</span>
      <div className="flex flex-wrap gap-2.5">
        {items.map((it) => (
          <div key={it.title} className="w-72 max-w-full rounded-lg px-3 py-3.5" style={RAISED_BTN}>
            <div className="text-[11px] font-bold" style={{ color: DECK_A }}>{it.title}</div>
            <div className="mt-0.5 text-[10.5px] leading-snug text-white/60">{it.body}</div>
          </div>
        ))}
      </div>
    </div>
  )
}

/** Vista TAG LIST: Historial real — cada vez que un plato real arranca una pista nueva queda anotado acá, más reciente arriba. */
function HistoryView({ history, onClear }: { history: { name: string; at: number }[]; onClear: () => void }) {
  const fmt = (at: number) => new Date(at).toLocaleTimeString('es-DO', { hour: '2-digit', minute: '2-digit' })
  return (
    <div className="absolute inset-0 flex flex-col overflow-y-auto p-4 text-left">
      <div className="mb-3 flex items-center justify-between gap-2">
        <span className="text-[10px] font-bold tracking-[0.12em] text-white/50">
          HISTORIAL{history.length > 0 && <span className="ml-1 font-normal text-white/30">({history.length})</span>}
        </span>
        {history.length > 0 && (
          <button type="button" onClick={onClear} className="rounded-full px-2.5 py-1 text-[10px] font-bold text-red-300" style={RAISED_BTN}>Vaciar</button>
        )}
      </div>
      {history.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-1.5 text-white/25">
          <span className="text-[11px] uppercase tracking-wide">Todavía no sonó nada</span>
          <span className="max-w-[240px] text-center text-[10px] text-white/20">
            Cada canción que arranca a sonar de verdad en un plato (manual o por la Mezcla Automática) queda anotada acá sola
          </span>
        </div>
      ) : (
        <div className="flex flex-wrap gap-1.5">
          {history.map((h, i) => (
            <div key={`${h.at}-${i}`} className="flex w-72 max-w-full items-center gap-3 rounded-lg px-3 py-3.5" style={RAISED_BTN}>
              <span className="font-mono text-[9.5px] text-white/30">{fmt(h.at)}</span>
              <span className="min-w-0 flex-1 truncate text-[11px] font-semibold text-white/80">{h.name}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

/**
 * DJ IA — Pantalla del botón "DJ IA" del nav superior (StudioHome,
 * congelado). Vista que replica la referencia aprobada por el usuario:
 * panel de video, dos decks con jog wheel, mixer de 4 canales y
 * reproductor inferior. Los dos platos son reales (Web Audio real:
 * scratch por arrastre, play/pause, pista demo cargada) — el resto del
 * mezclador sigue siendo maqueta visual, a la espera de una fase
 * siguiente.
 */
const DECK_A = '#d4ff00'
const DECK_A_SOFT = '#a8cc00'
const DECK_B = '#b26bff'

/**
 * Modo energía — parámetro real del Asistente DJ IA, no una etiqueta
 * decorativa: cambia cuánto dura el cruce entre canciones (más largo y
 * suave en "suave", más corto y directo en "fiesta") y el nivel real
 * del master.
 */
type EnergyMode = 'suave' | 'normal' | 'fiesta'
const ENERGY_TRANSITION_SECONDS: Record<EnergyMode, number> = { suave: 14, normal: 8, fiesta: 4 }
const ENERGY_MASTER_LEVEL: Record<EnergyMode, number> = { suave: 0.8, normal: 0.9, fiesta: 1 }
const ENERGY_LABELS: Record<EnergyMode, string> = { suave: 'Suave', normal: 'Normal', fiesta: 'Fiesta' }

interface ScheduleConfig { enabled: boolean; days: number[]; time: string; target: 'mezcla' | 'lista' }
const WEEKDAY_LABELS = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb']

/**
 * Estilo real del contenedor de un plato en la pantalla VIDEO SCREEN:
 * visible/oculto según el foco, y corre la animación CSS de entrada o
 * salida (según corresponda) mientras dura el cambio de plato.
 */
function ytSourcePanelStyle(deck: 1 | 2, tabActive: boolean, focus: 1 | 2 | null, leaving: 1 | 2 | null, transition: VideoTransitionType): React.CSSProperties {
  const isLeaving = leaving === deck
  const isFocused = focus === deck
  if (!tabActive || (!isFocused && !isLeaving)) return { visibility: 'hidden', pointerEvents: 'none' }
  const animationName = isLeaving ? `dj-video-${transition}-out` : leaving != null ? `dj-video-${transition}-in` : undefined
  return {
    visibility: 'visible',
    pointerEvents: isFocused ? 'auto' : 'none',
    zIndex: isLeaving ? 1 : 2,
    animation: animationName ? `${animationName} 600ms ease forwards` : undefined,
  }
}

/** Transiciones de video reales (CSS, animan los elementos de verdad) al cambiar de plato en pantalla — mismo concepto que el selector de transiciones de un mezclador de video real. */
type VideoTransitionType = 'fade' | 'cube' | 'slide' | 'flip' | 'zoom' | 'glass'
const VIDEO_TRANSITIONS: { key: VideoTransitionType; label: string }[] = [
  { key: 'fade', label: 'Fade' },
  { key: 'cube', label: 'Cube' },
  { key: 'slide', label: 'Slide' },
  { key: 'flip', label: 'Flip' },
  { key: 'zoom', label: 'Zoom' },
  { key: 'glass', label: 'Glass' },
]

/**
 * Liquid Glass — panel base: vidrio oscuro con reflejo suave arriba a
 * la izquierda (igual referencia visual aprobada por la Dirección:
 * negro/gris profundo, brillo especular de vidrio, nunca metal
 * cepillado). Mismo material en toda la consola.
 */
const METAL_PANEL: React.CSSProperties = {
  background: 'radial-gradient(130% 110% at 26% -18%, rgba(255,255,255,0.1), transparent 45%), linear-gradient(165deg, #1a1c21 0%, #0d0e11 50%, #020202 100%)',
  boxShadow: 'inset 0 1px 1px rgba(255,255,255,0.12), inset 0 -1px 0 rgba(0,0,0,0.8), inset 0 0 60px rgba(255,255,255,0.02), 0 28px 56px rgba(0,0,0,0.65)',
}

/** Reflejo de vidrio real — franja especular nítida (no solo gradiente difuso) igual a como la luz real rebota en una curva de vidrio, más el difuso diagonal atrás. */
function MetalGrain() {
  return (
    <>
      <div
        className="pointer-events-none absolute inset-0"
        style={{ background: 'linear-gradient(135deg, rgba(255,255,255,0.07) 0%, rgba(255,255,255,0.02) 22%, transparent 45%)' }}
        aria-hidden="true"
      />
      <div
        className="pointer-events-none absolute inset-x-0 top-0 h-1/2"
        style={{ background: 'linear-gradient(180deg, rgba(255,255,255,0.08) 0%, transparent 100%)', maskImage: 'linear-gradient(180deg, black, transparent)' }}
        aria-hidden="true"
      />
    </>
  )
}

/**
 * Botón Liquid Glass — TODOS los controles llevan el formato de
 * tarjeta de la referencia ("Shades of Blue"): barra en el borde
 * izquierdo, no solo cuando están activos/seleccionados — acá en
 * blanco tenue (el color fuerte queda para `raisedActive`), para que
 * se lea vidrio de verdad en reposo también, no una superficie plana.
 */
const RAISED_BTN: React.CSSProperties = {
  borderLeft: '3px solid rgba(255,255,255,0.24)',
  borderTop: '1px solid rgba(255,255,255,0.08)',
  borderRight: '1px solid rgba(255,255,255,0.06)',
  borderBottom: '1px solid rgba(0,0,0,0.4)',
  background: 'linear-gradient(160deg, rgba(255,255,255,0.12) 0%, rgba(255,255,255,0.02) 24%, rgba(0,0,0,0.5) 100%), radial-gradient(140% 200% at 20% -40%, rgba(255,255,255,0.22), transparent 42%)',
  boxShadow: 'inset 3px 0 12px -8px rgba(255,255,255,0.5), inset 0 1px 1px rgba(255,255,255,0.28), inset 0 -4px 8px rgba(0,0,0,0.6), 0 6px 14px rgba(0,0,0,0.5)',
}

/**
 * Vidrio activo — dos referencias combinadas: el vidrio brillante
 * (material) queda igual de oscuro que en reposo, y el color de
 * acento vive en una barra en el borde izquierdo con resplandor real
 * sangrando hacia adentro (estilo tarjeta "Shades of Blue"), no
 * bañando todo el botón. Texto blanco siempre. Intensidad al máximo
 * a pedido explícito de la Dirección — sin exagerar el color en sí,
 * solo el brillo/resplandor real.
 */
function raisedActive(color: string): React.CSSProperties {
  return {
    borderLeft: `3px solid ${color}`,
    borderTop: '1px solid rgba(255,255,255,0.16)',
    borderRight: '1px solid rgba(255,255,255,0.1)',
    borderBottom: '1px solid rgba(0,0,0,0.4)',
    color: '#fff',
    background: `linear-gradient(160deg, rgba(255,255,255,0.26) 0%, rgba(255,255,255,0.04) 24%, rgba(0,0,0,0.55) 100%), radial-gradient(140% 200% at 20% -40%, rgba(255,255,255,0.6), transparent 42%), linear-gradient(90deg, ${color}55, transparent 55%)`,
    boxShadow: `inset 3px 0 22px -6px ${color}, inset 0 2px 2px rgba(255,255,255,0.55), inset 0 -4px 8px rgba(0,0,0,0.6), 0 0 26px ${color}a0, 0 0 50px ${color}50, 0 6px 14px rgba(0,0,0,0.5)`,
  }
}

/**
 * Perilla real: arrastrar verticalmente sube/baja `value` (-1..1).
 * Sin `onChange` queda decorativa (mismo aspecto de siempre). La
 * aguja gira de verdad según `value` en vez de quedar fija arriba.
 */
function Dial({ active, value = 0, onChange, color }: { active?: boolean; value?: number; onChange?: (v: number) => void; color?: string }) {
  const dragRef = useRef<{ y: number; value: number } | null>(null)
  const dc = color ?? DECK_A

  const onPointerDown = useCallback((e: PointerEvent<HTMLDivElement>) => {
    if (!onChange) return
    e.currentTarget.setPointerCapture(e.pointerId)
    dragRef.current = { y: e.clientY, value }
  }, [onChange, value])
  const onPointerMove = useCallback((e: PointerEvent<HTMLDivElement>) => {
    if (!onChange || !dragRef.current) return
    const delta = (dragRef.current.y - e.clientY) / 100
    onChange(Math.min(1, Math.max(-1, dragRef.current.value + delta)))
  }, [onChange])
  const onPointerUp = useCallback(() => { dragRef.current = null }, [])

  const angle = value * 132
  const lit = active || (onChange != null && value !== 0)

  return (
    <div
      className="relative h-6.5 w-6.5 rounded-full"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      style={{
        background: 'radial-gradient(circle at 32% 26%, #3a3d44 0%, #1d1f24 46%, #0a0b0c 100%)',
        boxShadow: 'inset 0 0 0 1px rgba(255,255,255,0.1), inset 0 -2px 3px rgba(0,0,0,0.6), 0 2px 4px rgba(0,0,0,0.55), 0 0 0 3px rgba(0,0,0,0.35)',
        cursor: onChange ? 'ns-resize' : undefined,
        touchAction: onChange ? 'none' : undefined,
      }}
    >
      <span className="pointer-events-none absolute inset-[3px] rounded-full opacity-70" style={{ background: 'radial-gradient(circle at 34% 24%, rgba(255,255,255,0.35), transparent 55%)' }} />
      <div className="pointer-events-none absolute inset-0" style={{ transform: `rotate(${angle}deg)` }}>
        <span
          className="absolute left-1/2 top-[3px] h-[7px] w-[1.5px] -translate-x-1/2 rounded-full"
          style={lit ? { background: dc, boxShadow: `0 0 5px ${dc}, 0 0 2px #fff` } : { background: 'rgba(255,255,255,0.5)', boxShadow: '0 0 2px rgba(0,0,0,0.6)' }}
        />
      </div>
    </div>
  )
}

export interface ChannelState {
  trim: number
  eqHigh: number
  eqMid: number
  eqLow: number
  filter: number
  fader: number
  cueOn: boolean
}

const DEFAULT_CHANNEL_STATE: ChannelState = { trim: 0, eqHigh: 0, eqMid: 0, eqLow: 0, filter: 0, fader: 0.85, cueOn: false }
const EQ_RANGE_DB = 24

function channelStateFromEngine(engine: DeckEngine): ChannelState {
  return {
    trim: engine.trim - 1,
    eqHigh: engine.eq.high / EQ_RANGE_DB,
    eqMid: engine.eq.mid / EQ_RANGE_DB,
    eqLow: engine.eq.low / EQ_RANGE_DB,
    filter: engine.colorFxType === 'filter' ? engine.colorFxAmount : 0,
    fader: engine.gain,
    cueOn: engine.cueOn,
  }
}

function channelPatchToEngine(engine: DeckEngine, patch: Partial<ChannelState>) {
  if (patch.trim !== undefined) engine.setTrim(1 + patch.trim)
  if (patch.eqHigh !== undefined) engine.setEq('high', patch.eqHigh * EQ_RANGE_DB)
  if (patch.eqMid !== undefined) engine.setEq('mid', patch.eqMid * EQ_RANGE_DB)
  if (patch.eqLow !== undefined) engine.setEq('low', patch.eqLow * EQ_RANGE_DB)
  if (patch.filter !== undefined) { engine.setColorFxType('filter'); engine.setColorFxAmount(patch.filter); engine.setFxSendActive(patch.filter !== 0) }
  if (patch.fader !== undefined) engine.setGain(patch.fader)
}

/**
 * Canal real del mezclador: TRIM/HIGH/MID/LOW/FILTER, fader y CUE
 * todos arrastrables/clicables de verdad. CH1/CH2 controlan el motor
 * real del plato correspondiente (EQ/trim/ganancia/cue ya existían en
 * el engine, el FILTER reutiliza el Sound Color FX tipo "filter").
 * CH3/CH4 no tienen pista real detrás (la app solo tiene 2 platos),
 * así que quedan con su propio estado local — responden igual, sin
 * pretender procesar un audio que no existe.
 */
function ChannelStrip({ label, color, meterPct, state, onChange, onCue, noRealEffect, noRealEffectTitle, noRealEffectBadge }: {
  label: string
  color: string
  meterPct: number
  state: ChannelState
  onChange: (patch: Partial<ChannelState>) => void
  onCue: () => void
  /** Plato con un video de YouTube cargado: TRIM/EQ/FILTER se pueden mover pero no cambian el sonido — el audio del iframe no pasa por este mezclador. Verlo en HelpView (AYUDA) para la explicación completa. */
  noRealEffect?: boolean
  noRealEffectTitle?: string
  noRealEffectBadge?: string
}) {
  const dragRef = useRef<{ y: number; value: number } | null>(null)
  const onFaderPointerDown = useCallback((e: PointerEvent<HTMLDivElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId)
    dragRef.current = { y: e.clientY, value: state.fader }
  }, [state.fader])
  const onFaderPointerMove = useCallback((e: PointerEvent<HTMLDivElement>) => {
    if (!dragRef.current) return
    const delta = (e.clientY - dragRef.current.y) / 90
    onChange({ fader: Math.min(1, Math.max(0, dragRef.current.value - delta)) })
  }, [onChange])
  const onFaderPointerUp = useCallback(() => { dragRef.current = null }, [])

  return (
    <div className="flex flex-col items-center gap-2">
      <span className="text-[9px] font-bold tracking-[0.1em] text-white/40">{label}</span>
      {noRealEffect && (
        <span
          title={noRealEffectTitle ?? 'TRIM/EQ/FILTER no cambian el sonido de un video de YouTube — su audio no pasa por este mezclador. Ver AYUDA.'}
          className="-mt-1.5 rounded-full px-1.5 py-[1px] text-[6px] font-bold uppercase tracking-wide text-amber-300"
          style={{ background: 'rgba(217,119,6,0.18)' }}
        >
          {noRealEffectBadge ?? 'EQ sin efecto (YT)'}
        </span>
      )}
      <div className="flex flex-col items-center gap-[2px]">
        <Dial value={state.trim} onChange={(v) => onChange({ trim: v })} color={color} active />
        <span className="-mt-[1px] text-[7px] tracking-[0.08em] text-white/30">TRIM</span>
      </div>
      <div className="flex flex-col items-center gap-[2px]">
        <Dial value={state.eqHigh} onChange={(v) => onChange({ eqHigh: v })} color={color} active />
        <span className="-mt-[1px] text-[7px] tracking-[0.08em] text-white/30">HIGH</span>
      </div>
      <div className="flex flex-col items-center gap-[2px]">
        <Dial value={state.eqMid} onChange={(v) => onChange({ eqMid: v })} color={color} active />
        <span className="-mt-[1px] text-[7px] tracking-[0.08em] text-white/30">MID</span>
      </div>
      <div className="flex flex-col items-center gap-[2px]">
        <Dial value={state.eqLow} onChange={(v) => onChange({ eqLow: v })} color={color} active />
        <span className="-mt-[1px] text-[7px] tracking-[0.08em] text-white/30">LOW</span>
      </div>
      <div className="flex flex-col items-center gap-[2px]">
        <Dial value={state.filter} onChange={(v) => onChange({ filter: v })} color={color} active />
        <span className="-mt-[1px] text-[7px] tracking-[0.08em] text-white/30">FILTER</span>
      </div>
      <button
        type="button"
        onClick={onCue}
        className="mt-1 rounded-md px-2.5 py-1 text-[8.5px] font-bold"
        style={state.cueOn ? raisedActive(color) : { ...RAISED_BTN, color: 'rgba(255,255,255,0.45)' }}
      >
        CUE
      </button>
      <div
        className="relative mt-1.5 h-[100px] w-[22px] touch-none rounded"
        style={{ background: 'linear-gradient(180deg,#020203,#0c0d0f)', boxShadow: 'inset 0 0 0 1px rgba(255,255,255,0.1), inset 0 2px 6px rgba(0,0,0,0.7)' }}
      >
        <div className="absolute -left-2 bottom-0 top-0 w-[3px] overflow-hidden rounded-sm bg-white/[0.06]">
          <span
            className="dj-meter-fill absolute bottom-0 left-0 right-0 origin-bottom"
            style={
              {
                height: `${meterPct}%`,
                background: 'linear-gradient(0deg, #3ddc6f 0%, #3ddc6f 55%, #e8d44d 78%, #ef4444 100%)',
                boxShadow: '0 0 4px rgba(61,220,111,0.6)',
              } as React.CSSProperties
            }
          />
        </div>
        <div
          onPointerDown={onFaderPointerDown}
          onPointerMove={onFaderPointerMove}
          onPointerUp={onFaderPointerUp}
          onPointerCancel={onFaderPointerUp}
          className="absolute left-1/2 h-[13px] w-[20px] -translate-x-1/2 -translate-y-1/2 cursor-ns-resize rounded-[3px]"
          style={{
            top: `${(1 - state.fader) * 100}%`,
            background: 'linear-gradient(180deg, #52565f 0%, #2c2e33 45%, #0c0d0f 100%)',
            boxShadow: '0 3px 6px rgba(0,0,0,0.6), inset 0 1px 0 rgba(255,255,255,0.35), inset 0 -1px 0 rgba(0,0,0,0.5)',
          }}
        >
          <span className="pointer-events-none absolute left-1/2 top-1/2 h-px w-3.5 -translate-x-1/2 -translate-y-1/2 bg-black/50" />
        </div>
      </div>
    </div>
  )
}

function DeckUnit({ side, num, active, engine, syncTargetBpm, syncTargetEngine, jogSensitivity, onJogSensitivity, ytOverride, onLoadLocalFile, libraryTrackId }: { side: 'a' | 'b'; num: number; active: 'cue' | 'sync'; engine: DeckEngine; syncTargetBpm: number | null; syncTargetEngine: DeckEngine; jogSensitivity: number; onJogSensitivity: (v: number) => void; ytOverride?: YtOverride | null; onLoadLocalFile: (file: File) => void; libraryTrackId: string | null }) {
  // Fase 12 — Memory Cues reales: cada vez que los Hot Cues de este
  // plato cambian (marcar/borrar uno), si el archivo cargado vino de
  // la Music Library (identidad real conocida), el cambio se persiste
  // ahí mismo — así sobrevive a cargar otra pista y volver a esta.
  // Sin `libraryTrackId` (selector de archivo suelto, puente MUSIC) no
  // hay a qué registro guardarle nada, así que no hace nada.
  useEffect(() => {
    if (!libraryTrackId) return
    void updateTrackHotCues(libraryTrackId, engine.hotCues)
  }, [libraryTrackId, engine.hotCues])
  const dc = side === 'a' ? DECK_A : DECK_B
  // Fase 10 — BEAT SYNC real: `syncLocked` convierte el botón SYNC de
  // un "empujón" de una sola vez en un lock real que se mantiene — si
  // el otro plato cambia de tempo mientras está activo, este vuelve a
  // alinearse solo (tempo + fase, no solo el número de BPM). Se apaga
  // solo si cualquiera de los dos platos carga una pista nueva (seguir
  // "sincronizado" a una pista que ya no es la que sonaba sería mentir).
  const [syncLocked, setSyncLocked] = useState(false)
  const prevTrackNamesRef = useRef<{ own: string | null; other: string | null }>({ own: engine.trackName, other: syncTargetEngine.trackName })
  useEffect(() => {
    const changed = prevTrackNamesRef.current.own !== engine.trackName || prevTrackNamesRef.current.other !== syncTargetEngine.trackName
    prevTrackNamesRef.current = { own: engine.trackName, other: syncTargetEngine.trackName }
    if (changed) setSyncLocked(false)
  }, [engine.trackName, syncTargetEngine.trackName])
  useEffect(() => {
    if (!syncLocked || syncTargetEngine.bpm == null) return
    engine.syncTo(syncTargetEngine.bpm, syncTargetEngine.beatGrid, syncTargetEngine.currentTime)
    // Se re-alinea a propósito cada vez que cambia el BPM real del otro
    // plato (p.ej. si le tocan el pitch) — "mantenerse sincronizado
    // durante el tiempo", no un ajuste de una sola vez.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [syncLocked, syncTargetEngine.bpm])
  const [padMode, setPadMode] = useState<PadMode>('hotcue')
  const [vinylMode, setVinylMode] = useState<'TOUCH' | 'VOCAL' | 'ACTIVE PART'>('TOUCH')
  const [ringEffect, setRingEffect] = useState<RingLightEffect>(() => readLS(`dj-ia:ringEffect:${side}`, 'static' as RingLightEffect))
  useEffect(() => { persisted(`dj-ia:ringEffect:${side}`, ringEffect) }, [ringEffect, side])
  const cycleRingEffect = useCallback(() => {
    setRingEffect((prev) => RING_LIGHT_EFFECTS[(RING_LIGHT_EFFECTS.indexOf(prev) + 1) % RING_LIGHT_EFFECTS.length])
  }, [])

  // Sin pista/video cargado no hay nada que estos botones puedan
  // hacer (no existe audio para tocar) — antes quedaban en silencio
  // total al tocarlos, lo cual se leía como "no funciona nada" aunque
  // el motor esté bien. Ahora avisan por qué no responden. Mismo
  // mecanismo para Pad FX/Keyboard sobre un video de YouTube: esos dos
  // modos son un no-op real en `useYoutubeDeckEngine` (no hay buffer
  // que retocar), así que ahora avisan en vez de quedar en silencio.
  const hasTrack = engine.trackName != null
  const isYoutubeSource = !!ytOverride
  const [karaokeProgress, setKaraokeProgress] = useState<number | null>(null)
  const [karaokeReady, setKaraokeReady] = useState(false)
  // El motor de "PISTA" (ffmpeg.wasm) pesa ~32MB — precargarlo apenas se
  // abre DJ IA evita que el primer click en "PISTA" se quede pegado en
  // 0% varios segundos (parece trabado, no es un bug del filtro en sí)
  // mientras baja el motor. Mismo patrón que `preloadVideoEncoder` en
  // `CreateReelModal.tsx` de CIELO. `karaokeReady` distingue esa espera
  // inicial ("Preparando…") del progreso real del filtro (0-100%).
  useEffect(() => {
    let cancelled = false
    preloadKaraokeEncoder().then(() => { if (!cancelled) setKaraokeReady(true) })
    return () => { cancelled = true }
  }, [])
  const [hintMessage, setHintMessage] = useState<string | null>(null)
  const hintTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const showHint = useCallback((msg: string) => {
    setHintMessage(msg)
    if (hintTimer.current) clearTimeout(hintTimer.current)
    hintTimer.current = setTimeout(() => setHintMessage(null), 1600)
  }, [])
  const guard = useCallback((fn: () => void) => () => {
    if (!hasTrack) { showHint('Cargá una pista o video primero'); return }
    fn()
  }, [hasTrack, showHint])
  const handleCreateKaraoke = useCallback(async () => {
    const file = engine.getLoadedFile()
    if (!file) { showHint('Cargá un archivo de audio primero'); return }
    setKaraokeProgress(0)
    try {
      const karaokeFile = await createKaraokeTrack(file, (ratio) => setKaraokeProgress(ratio))
      engine.loadFile(karaokeFile)
    } catch (err) {
      // Mismo criterio que el resto del motor: mostrar el motivo real en
      // consola, no un mensaje genérico que desaparece a los 1.6s sin
      // dejar rastro de qué falló de verdad.
      console.error('[DJ IA] PISTA (karaoke) falló:', err)
      showHint('No se pudo crear la pista de karaoke')
    } finally {
      setKaraokeProgress(null)
    }
  }, [engine, showHint])
  const pitch = (
    <div className="flex flex-col items-center gap-1.5">
      <div className="relative h-[190px] w-[22px] rounded" style={{ background: 'linear-gradient(180deg,#020203,#0c0d0f)', boxShadow: 'inset 0 0 0 1px rgba(255,255,255,0.1), inset 0 2px 6px rgba(0,0,0,0.7)' }}>
        <div className="absolute -left-[3px] -right-[3px] top-1/2 h-px opacity-60" style={{ background: dc }} />
        <input
          type="range"
          min={-1}
          max={1}
          step={0.001}
          value={engine.pitch}
          onChange={(e) => engine.setPitch(Number(e.target.value))}
          className="absolute inset-0 h-full w-full cursor-ns-resize opacity-0"
          style={{ writingMode: 'vertical-lr', direction: 'rtl' }}
          aria-label={`Tempo deck ${num}`}
        />
        <div
          className="pointer-events-none absolute left-1/2 h-[13px] w-[20px] -translate-x-1/2 -translate-y-1/2 rounded-[3px]"
          style={{ top: `${(1 - (engine.pitch + 1) / 2) * 100}%`, background: 'linear-gradient(180deg, #52565f 0%, #2c2e33 45%, #0c0d0f 100%)', boxShadow: `0 3px 6px rgba(0,0,0,0.6), inset 0 1px 0 rgba(255,255,255,0.35), inset 0 0 0 1px ${dc}` }}
        />
      </div>
      <button type="button" onClick={guard(engine.resetTempo)} className="rounded px-1.5 py-0.5 text-[7px] font-bold tracking-[0.06em] text-white/40" style={RAISED_BTN}>TEMPO RESET</button>
    </div>
  )
  const jog = (
    <div style={{ width: 'clamp(220px, 21vw, 320px)', flexShrink: 0 }}>
      <JogWheel num={num} color={dc} engine={engine} sensitivity={jogSensitivity} ytOverride={ytOverride} lightEffect={ringEffect} />
    </div>
  )
  return (
    <div className="relative flex flex-col items-center gap-3.5 overflow-hidden rounded-2xl p-3.5" style={METAL_PANEL}>
      <MetalGrain />
      <div className="relative flex w-full items-center justify-between gap-1">
        <div className="flex gap-1">
          {(['TOUCH', 'VOCAL', 'ACTIVE PART'] as const).map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => setVinylMode(c)}
              className="rounded px-1.5 py-1 text-[7px] font-bold tracking-[0.04em]"
              style={vinylMode === c ? raisedActive(dc) : { ...RAISED_BTN, color: 'rgba(255,255,255,0.4)' }}
            >
              {c}
            </button>
          ))}
        </div>
        <div className="flex gap-1">
          <button
            type="button"
            onClick={cycleRingEffect}
            className="rounded px-2 py-1 text-[7.5px] font-bold tracking-[0.06em]"
            style={ringEffect !== 'static' ? raisedActive(dc) : { ...RAISED_BTN, color: 'rgba(255,255,255,0.4)' }}
            title="Efecto de luz del aro"
          >
            LUZ: {RING_LIGHT_LABELS[ringEffect]}
          </button>
          <button
            type="button"
            onClick={() => engine.setSlip(!engine.slip)}
            className="rounded px-2 py-1 text-[7.5px] font-bold tracking-[0.06em]"
            style={engine.slip ? raisedActive(dc) : { ...RAISED_BTN, color: 'rgba(255,255,255,0.4)' }}
          >
            SLIP
          </button>
        </div>
      </div>
      <div className="relative flex w-full items-center gap-2">
        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border text-[10px] font-bold" style={{ borderColor: dc, color: dc }}>{num}</span>
        <span className="min-w-0 flex-1 truncate text-[10px] font-semibold text-white/70">
          {engine.isLoading ? 'Cargando…' : (engine.trackName ? `${engine.isVideoTrack ? '🎥' : '🎵'} ${engine.trackName}` : 'Sin pista')}
        </span>
        <label
          className="flex shrink-0 cursor-pointer items-center gap-1 rounded-md px-2 py-1 text-[9px] font-bold"
          style={RAISED_BTN}
        >
          LOAD
          <input
            type="file"
            accept="audio/*,video/*"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0]
              if (file) onLoadLocalFile(file)
              e.target.value = ''
            }}
          />
        </label>
        <button
          type="button"
          onClick={() => {
            if (!engine.getLoadedFile()) { showHint('Cargá un archivo de audio primero (no funciona sobre YouTube ni Música de MABRIONA)'); return }
            void handleCreateKaraoke()
          }}
          disabled={karaokeProgress !== null}
          className="shrink-0 rounded-md px-2 py-1 text-[9px] font-bold disabled:opacity-40"
          style={RAISED_BTN}
          title="Crear una versión de esta pista sin voz (karaoke, cancelación de canal central)"
        >
          {karaokeProgress !== null
            ? (karaokeProgress === 0 && !karaokeReady ? 'Preparando…' : `${Math.round(karaokeProgress * 100)}%`)
            : 'PISTA'}
        </button>
        <div className="flex flex-col items-center gap-0.5">
          <Dial
            active
            color={dc}
            value={Math.min(1, Math.max(-1, jogSensitivity - 1))}
            onChange={(v) => onJogSensitivity(Math.min(2, Math.max(0.4, 1 + v)))}
          />
          <span className="text-[6px] tracking-[0.06em] text-white/30">JOG FEEL {jogSensitivity.toFixed(2)}x</span>
        </div>
      </div>
      <div className="relative flex items-center gap-2.5">
        {side === 'a' ? (
          <>
            {pitch}
            {jog}
          </>
        ) : (
          <>
            {jog}
            {pitch}
          </>
        )}
      </div>
      <div className="flex w-full items-center justify-center gap-3 text-white/40">
        <button type="button" onClick={guard(() => engine.beatJump(-4))} className="rounded px-2 py-0.5 text-[9px] font-bold" style={RAISED_BTN}>◀ BEAT</button>
        <span className="text-[8px] tracking-[0.1em] text-white/30">JUMP / SEARCH</span>
        <button type="button" onClick={guard(() => engine.beatJump(4))} className="rounded px-2 py-0.5 text-[9px] font-bold" style={RAISED_BTN}>BEAT ▶</button>
      </div>
      <div className="relative flex gap-2">
        {hintMessage && (
          <span
            className="absolute -top-6 left-1/2 z-20 -translate-x-1/2 whitespace-nowrap rounded-md px-2 py-1 text-[8.5px] font-bold text-white shadow-lg"
            style={{ background: 'rgba(220,38,38,0.92)' }}
          >
            {hintMessage}
          </span>
        )}
        <button type="button" onClick={guard(engine.cuePress)} className="rounded-lg border px-3 py-1.5 text-[10px] font-bold" style={active === 'cue' ? raisedActive(dc) : { ...RAISED_BTN, borderColor: 'transparent', color: 'rgba(255,255,255,0.45)' }}>
          CUE
        </button>
        <button
          type="button"
          onClick={guard(engine.togglePlay)}
          aria-label={engine.isPlaying ? 'Pausar' : 'Reproducir'}
          className="flex h-[30px] w-[34px] items-center justify-center rounded-lg"
          style={{ background: `linear-gradient(180deg, ${dc}, ${DECK_A_SOFT})`, boxShadow: `inset 0 1px 0 rgba(255,255,255,0.5), inset 0 -2px 3px rgba(0,0,0,0.25), 0 0 24px ${dc}b3, 0 0 44px ${dc}5c, 0 2px 5px rgba(0,0,0,0.4)` }}
        >
          {engine.isPlaying
            ? <IconPause className="h-3 w-3 text-black drop-shadow-[0_1px_0_rgba(255,255,255,0.4)]" />
            : <IconPlay className="h-3 w-3 text-black drop-shadow-[0_1px_0_rgba(255,255,255,0.4)]" />}
        </button>
        <button
          type="button"
          onClick={guard(() => { if (syncTargetBpm) setSyncLocked((v) => !v) })}
          className="rounded-lg border px-3 py-1.5 text-[10px] font-bold"
          style={syncLocked ? raisedActive(dc) : { ...RAISED_BTN, borderColor: 'transparent', color: 'rgba(255,255,255,0.45)' }}
        >
          SYNC
        </button>
        <button type="button" onClick={guard(engine.tapTempo)} className="rounded-lg px-3 py-1.5 text-[10px] font-bold text-white/45" style={RAISED_BTN}>TAP BPM</button>
      </div>
      <div className="flex w-full flex-col gap-1.5">
        <span className="text-[9px] font-bold tracking-[0.08em] text-white/40">LOOP</span>
        <div className="flex gap-1.5">
          <button type="button" onClick={guard(engine.setLoopIn)} className="flex-1 rounded-md py-1 text-center text-[9px] font-bold text-white/45" style={RAISED_BTN}>IN</button>
          <button type="button" onClick={guard(engine.setLoopOut)} className="flex-1 rounded-md py-1 text-center text-[9px] font-bold text-white/45" style={RAISED_BTN}>OUT</button>
          <button type="button" onClick={guard(engine.exitReloop)} className="flex-1 rounded-md py-1 text-center text-[9px] font-bold" style={engine.loop.active ? raisedActive(dc) : { ...RAISED_BTN, color: 'rgba(255,255,255,0.45)' }}>ACTIVE</button>
        </div>
        <div className="grid grid-cols-7 gap-1">
          {QUICK_LOOP_LABELS.map((c) => {
            // Refleja el loop realmente activo (redondeado, por ruido de
            // punto flotante en start/end) en vez de un índice fijo — antes
            // el botón "4" (posición 3) quedaba siempre resaltado sin
            // importar qué loop se hubiera activado de verdad.
            const beatSeconds = 60 / (engine.bpm ?? 120)
            const activeBeats = engine.loop.active && engine.loop.start != null && engine.loop.end != null
              ? Math.round(((engine.loop.end - engine.loop.start) / beatSeconds) * 100) / 100
              : null
            const isActive = activeBeats != null && Math.abs(activeBeats - loopLabelToBeats(c)) < 0.01
            return (
              <button key={c} type="button" onClick={guard(() => engine.setAutoLoop(loopLabelToBeats(c)))} className="rounded-md py-1 text-center text-[9px] font-bold" style={isActive ? raisedActive(dc) : { ...RAISED_BTN, color: 'rgba(255,255,255,0.45)' }}>
                {c}
              </button>
            )
          })}
        </div>
      </div>
      <div className="flex w-full items-center gap-1">
        <button type="button" onClick={engine.togglePage} className="rounded px-1 py-1.5 text-[9px] font-bold text-white/40" style={RAISED_BTN}>◀</button>
        <div className="grid flex-1 grid-cols-3 gap-1">
          {PAD_MODE_BUTTONS.map((m) => (
            <button
              key={m.label}
              type="button"
              onClick={() => setPadMode(m.mode)}
              className="rounded-md py-1 text-center text-[7.5px] font-bold leading-tight"
              style={padMode === m.mode ? raisedActive(dc) : { ...RAISED_BTN, color: 'rgba(255,255,255,0.45)' }}
            >
              {m.label}
            </button>
          ))}
        </div>
        <button type="button" onClick={engine.togglePage} className="rounded px-1 py-1.5 text-[9px] font-bold text-white/40" style={RAISED_BTN}>▶</button>
      </div>
      <div className="grid w-full grid-cols-4 gap-1.5">
        {Array.from({ length: 8 }, (_, i) => {
          const slot = engine.page * 8 + i
          const cueSet = engine.hotCues[slot]?.time != null
          const isFxHold = padMode === 'padfx'
          const active = padMode === 'hotcue' || padMode === 'sampler' ? cueSet : true
          return (
            <button
              key={i}
              type="button"
              onPointerDown={guard(() => {
                if (isYoutubeSource && (padMode === 'padfx' || padMode === 'keyboard')) {
                  showHint('Sin efecto real en un video de YouTube')
                  return
                }
                isFxHold ? engine.padFxDown(i) : engine.triggerPad(i, padMode)
              })}
              onPointerUp={() => (isFxHold ? engine.padFxUp() : engine.releasePad(padMode))}
              onPointerLeave={() => (isFxHold ? engine.padFxUp() : engine.releasePad(padMode))}
              aria-label={`Pad ${i + 1} (${padMode})`}
              className="flex aspect-[1.5] items-center justify-center rounded-md text-[10px] font-bold transition-transform active:scale-95"
              style={
                active
                  ? { background: `linear-gradient(180deg, ${dc}, ${dc}99)`, color: '#000', boxShadow: `0 0 18px ${dc}99, 0 0 34px ${dc}4d, inset 0 1px 0 rgba(255,255,255,0.4)` }
                  : {
                      background: 'linear-gradient(180deg, #34363b 0%, #1c1e22 55%, #0a0b0c 100%)',
                      color: 'rgba(255,255,255,0.5)',
                      boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.16), inset 0 -2px 4px rgba(0,0,0,0.55), 0 2px 4px rgba(0,0,0,0.4)',
                    }
              }
            >
              {i + 1}
            </button>
          )
        })}
      </div>
      <button type="button" onClick={engine.clearHotCues} className="text-[9.5px] text-white/30 underline decoration-white/20 underline-offset-2">Limpiar hot cues</button>
    </div>
  )
}

function readLS<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key)
    return raw != null ? (JSON.parse(raw) as T) : fallback
  } catch {
    return fallback
  }
}

function persisted<T>(key: string, value: T) {
  try { localStorage.setItem(key, JSON.stringify(value)) } catch { /* no crítico */ }
}

/**
 * Aislamiento real por cuenta (Etapa 5 de
 * `docs/FASE-0-AUDITORIA-ARQUITECTURA-MAESTRA.md`) — solo para los
 * datos de DJ IA que son de verdad "tuyos" (historial, cola de Mezcla
 * Automática, cola de YouTube): antes eran listas globales, sin
 * dueño. Los ajustes de UI/hardware del mezclador (brillo,
 * sensibilidad del jog, niveles de canal, etc.) quedan como estaban
 * — son preferencias del dispositivo/navegador, no contenido de una
 * cuenta, y aislarlos también hubiese significado tocar los ~30
 * puntos de persistencia de este archivo sin ganancia real de
 * seguridad. Migración única de la lista legada (sin dueño) hacia la
 * primera cuenta real que la usa — mismo criterio ya establecido en
 * `followRepository.ts`/`favoritesRepository.ts`.
 */
function migrateLegacyDjIaKey(legacyKey: string, accountId: string): void {
  const flagKey = `${legacyKey}:migrated-legacy:v1`
  if (typeof localStorage === 'undefined' || localStorage.getItem(flagKey)) return
  localStorage.setItem(flagKey, '1')
  const legacyRaw = localStorage.getItem(legacyKey)
  if (legacyRaw == null) return
  const scopedKey = `${legacyKey}:${accountId}`
  if (localStorage.getItem(scopedKey) != null) return
  localStorage.setItem(scopedKey, legacyRaw)
}

declare global {
  interface Window {
    YT?: { Player: new (el: HTMLElement, opts: any) => any }
    onYouTubeIframeAPIReady?: () => void
  }
}

/**
 * Reproductor real de YouTube (IFrame Player API oficial, no un
 * <iframe> suelto) — permite leer el estado real de play/pausa y el
 * tiempo, para que el plato asignado gire sincronizado de verdad con
 * el video, no de forma decorativa.
 */
function useYoutubePlayer(videoId: string | null) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const playerRef = useRef<any>(null)
  const [isPlaying, setIsPlaying] = useState(false)
  const [currentTime, setCurrentTime] = useState(0)
  const [duration, setDuration] = useState(0)
  // El tiempo real (para nudge/scratch) no puede depender del estado
  // de React, que solo se refresca cada 400ms por el poll — si el
  // usuario arrastra el plato rápido, cada nudge leería el mismo
  // valor viejo y los saltos se pisarían entre sí en vez de sumarse.
  // Esta ref se actualiza al toque, sin esperar al próximo render.
  const currentTimeRef = useRef(0)
  const [status, setStatus] = useState<'conectando' | 'listo' | 'error'>('conectando')
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!videoId) { setIsPlaying(false); setCurrentTime(0); setDuration(0); setStatus('conectando'); setError(null); return }
    if (!isValidYoutubeVideoId(videoId)) { setStatus('error'); setError(describeYoutubeError(2)); return }
    let cancelled = false
    let poll: ReturnType<typeof setInterval> | null = null
    setStatus('conectando')
    setError(null)

    const create = () => {
      if (cancelled || !containerRef.current || !window.YT) return
      playerRef.current = new window.YT.Player(containerRef.current, {
        videoId,
        playerVars: { playsinline: 1 },
        events: {
          onStateChange: (e: { data: number }) => setIsPlaying(e.data === 1),
          onReady: () => { setDuration(playerRef.current?.getDuration?.() ?? 0); setStatus('listo') },
          onError: (e: { data: number }) => { setStatus('error'); setError(describeYoutubeError(e.data)) },
        },
      })
      poll = setInterval(() => {
        const p = playerRef.current
        if (p?.getCurrentTime) {
          const t = p.getCurrentTime()
          currentTimeRef.current = t
          setCurrentTime(t)
          setDuration(p.getDuration())
        }
      }, 400)
    }

    if (window.YT?.Player) {
      create()
    } else {
      const prevReady = window.onYouTubeIframeAPIReady
      window.onYouTubeIframeAPIReady = () => { prevReady?.(); create() }
      if (!document.getElementById('yt-iframe-api')) {
        const tag = document.createElement('script')
        tag.id = 'yt-iframe-api'
        tag.src = 'https://www.youtube.com/iframe_api'
        tag.onerror = () => { if (!cancelled) { setStatus('error'); setError('no se pudo cargar la API de YouTube (revisá bloqueadores de anuncios)') } }
        document.body.appendChild(tag)
      }
    }

    return () => {
      cancelled = true
      if (poll) clearInterval(poll)
      try { playerRef.current?.destroy?.() } catch { /* el player ya no existe */ }
      playerRef.current = null
      setIsPlaying(false)
      setCurrentTime(0)
      setDuration(0)
    }
  }, [videoId])

  const play = useCallback(() => {
    try { playerRef.current?.playVideo?.() } catch (e) { setStatus('error'); setError(`no se pudo reproducir — ${String(e)}`) }
  }, [])
  const pause = useCallback(() => {
    try { playerRef.current?.pauseVideo?.() } catch (e) { setStatus('error'); setError(`no se pudo pausar — ${String(e)}`) }
  }, [])
  const seekTo = useCallback((seconds: number) => {
    try { playerRef.current?.seekTo?.(Math.max(0, seconds), true) } catch (e) { setStatus('error'); setError(`no se pudo saltar — ${String(e)}`) }
  }, [])
  const setRate = useCallback((rate: number) => {
    const p = playerRef.current
    if (!p?.setPlaybackRate) return
    try {
      const available: number[] = p.getAvailablePlaybackRates?.() ?? [1]
      const nearest = available.reduce((best, r) => (Math.abs(r - rate) < Math.abs(best - rate) ? r : best), available[0] ?? 1)
      p.setPlaybackRate(nearest)
    } catch (e) { setStatus('error'); setError(`no se pudo cambiar el tempo — ${String(e)}`) }
  }, [])
  // Volumen/mute reales — sí forman parte de la IFrame Player API
  // oficial (`setVolume`/`mute`/`unMute`), a diferencia de EQ/trim/FX
  // que necesitarían acceso al audio crudo (eso no lo tiene YouTube).
  const setVolume = useCallback((gain01: number) => {
    try { playerRef.current?.setVolume?.(volumeToYoutubeScale(gain01)) } catch { /* el player todavía no está listo */ }
  }, [])
  const setMuted = useCallback((muted: boolean) => {
    try { if (muted) playerRef.current?.mute?.(); else playerRef.current?.unMute?.() } catch { /* el player todavía no está listo */ }
  }, [])

  return { containerRef, isPlaying, currentTime, duration, play, pause, seekTo, setRate, setVolume, setMuted, status, error }
}

/**
 * Motor "falso" con la misma forma que DeckEngine, pero que en vez de
 * tocar un AudioBuffer controla el reproductor real de YouTube del
 * plato asignado — así los botones del plato (play/cue/loop/beat
 * jump/hot cues/pitch/tap bpm/volumen/mute) funcionan de verdad sobre
 * el video, en vez de quedar inertes. Volumen y mute SÍ son parte de
 * la IFrame Player API oficial (`setVolume`/`mute`/`unMute`) y se
 * aplican de verdad acá. EQ/trim/Sound Color FX/sync no pueden aplicar
 * a YouTube (necesitarían acceso al audio crudo, y acá solo hay
 * acceso al reproductor), así que esos quedan como estado local sin
 * efecto audible — igual que el motor real cuando no tiene pista
 * cargada.
 */
function useYoutubeDeckEngine(title: string, yt: {
  isPlaying: boolean; currentTime: number; duration: number; status: 'conectando' | 'listo' | 'error'
  play: () => void; pause: () => void; seekTo: (s: number) => void; setRate: (r: number) => void
  setVolume: (gain01: number) => void; setMuted: (muted: boolean) => void
}): DeckEngine {
  const [pitch, setPitchState] = useState(0)
  const [tempoRangePct, setTempoRangePct] = useState(16)
  const [trim, setTrimState] = useState(1)
  const [eq, setEqState] = useState<{ low: number; mid: number; high: number }>({ low: 0, mid: 0, high: 0 })
  const [colorFxType, setColorFxTypeState] = useState<ColorFxType>('filter')
  const [colorFxAmount, setColorFxAmountState] = useState(0)
  const [gain, setGainState] = useState(0.85)
  const [muted, setMuted] = useState(false)
  const [cueOn, setCueOn] = useState(false)
  const [fxSendActive, setFxSendActiveState] = useState(false)
  const [loop, setLoop] = useState<LoopRegion>({ start: null, end: null, active: false })
  const [hotCues, setHotCues] = useState<HotCue[]>(() => Array.from({ length: HOTCUE_SLOTS }, () => ({ time: null })))
  const [page, setPage] = useState(0)
  const [slip, setSlip] = useState(false)
  const [quantize, setQuantize] = useState(true)
  const [bpm, setBpm] = useState<number | null>(null)
  const tapTimesRef = useRef<number[]>([])
  const tapLockedRef = useRef(false)

  const setPitch = useCallback((v: number) => {
    setPitchState(v)
    yt.setRate(1 + v * (tempoRangePct / 100))
  }, [tempoRangePct, yt])
  const resetTempo = useCallback(() => setPitch(0), [setPitch])
  const cycleTempoRange = useCallback(() => setTempoRangePct((p) => (p === 16 ? 8 : p === 8 ? 6 : 16)), [])
  const tapTempo = useCallback(() => {
    const now = performance.now()
    if (tapTimesRef.current.length && now - tapTimesRef.current[tapTimesRef.current.length - 1] > 2000) {
      tapTimesRef.current = []
      tapLockedRef.current = false
    }
    if (tapLockedRef.current) return
    const taps = [...tapTimesRef.current, now]
    tapTimesRef.current = taps
    if (taps.length < 2) { setBpm((prev) => prev ?? 120); return }
    const intervals = taps.slice(1).map((t, i) => t - taps[i])
    const avgMs = intervals.reduce((a, b) => a + b, 0) / intervals.length
    setBpm(Math.round(60000 / avgMs))
    if (intervals.length >= 3) {
      const last3 = intervals.slice(-3)
      const avg3 = last3.reduce((a, b) => a + b, 0) / 3
      const steady = last3.every((v) => Math.abs(v - avg3) / avg3 < 0.04)
      if (steady) tapLockedRef.current = true
    }
  }, [])
  // No hay forma real de ajustar el tempo de un video de YouTube a un
  // BPM objetivo exacto (setPlaybackRate no es continuo) — sync no aplica aquí.
  const syncTo = useCallback((_targetBpm: number, _targetGrid?: import('./types').BeatGrid | null, _targetNow?: number) => {}, [])

  const togglePlay = useCallback(() => { if (yt.isPlaying) yt.pause(); else yt.play() }, [yt])
  const cuePress = useCallback(() => {
    yt.seekTo(hotCues[0].time ?? 0)
    if (!yt.isPlaying) yt.play()
  }, [hotCues, yt])
  const seekTo = useCallback((seconds: number) => yt.seekTo(seconds), [yt])
  const nudge = useCallback((deltaSeconds: number) => yt.seekTo(Math.max(0, yt.currentTime + deltaSeconds)), [yt])

  const setGain = useCallback((v: number) => { setGainState(v); yt.setVolume(v) }, [yt])
  const setTrim = useCallback((v: number) => setTrimState(v), [])
  const setEq = useCallback((band: EqBand, valueDb: number) => setEqState((prev) => ({ ...prev, [band]: valueDb })), [])
  const setColorFxType = useCallback((type: ColorFxType) => setColorFxTypeState(type), [])
  const setColorFxAmount = useCallback((amount: number) => setColorFxAmountState(amount), [])
  const toggleMuted = useCallback(() => setMuted((m) => { const next = !m; yt.setMuted(next); return next }), [yt])
  // Cada video nuevo crea un `window.YT.Player` nuevo (se destruye el anterior) — su volumen interno arranca
  // en el default de YouTube (100%, sin mute), así que hay que reaplicar el fader/mute de este plato apenas
  // el player queda listo, para no perder el ajuste que el usuario ya tenía puesto.
  useEffect(() => {
    if (yt.status === 'listo') { yt.setVolume(gain); yt.setMuted(muted) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [yt.status])
  const toggleCue = useCallback(() => setCueOn((c) => !c), [])
  const setFxSendActive = useCallback((active: boolean) => setFxSendActiveState(active), [])

  const setLoopIn = useCallback(() => { setLoop((prev) => ({ ...prev, start: yt.currentTime })) }, [yt])
  const setLoopOut = useCallback(() => {
    setLoop((prev) => {
      if (prev.start == null || yt.currentTime <= prev.start) return prev
      return { start: prev.start, end: yt.currentTime, active: false }
    })
  }, [yt])
  const exitReloop = useCallback(() => { setLoop((prev) => ({ ...prev, active: !prev.active })) }, [])
  const setAutoLoop = useCallback((beats: number) => {
    const beatSeconds = 60 / (bpm ?? 120)
    const start = yt.currentTime
    setLoop({ start, end: start + beatSeconds * beats, active: true })
  }, [bpm, yt])
  const loop4Beats = useCallback(() => setAutoLoop(4), [setAutoLoop])
  const beatJump = useCallback((beats: number) => {
    const beatSeconds = 60 / (bpm ?? 120)
    yt.seekTo(Math.max(0, yt.currentTime + beatSeconds * beats))
  }, [bpm, yt])

  const togglePage = useCallback(() => setPage((p) => (p === 0 ? 1 : 0)), [])

  const triggerPad = useCallback((index: number, mode: PadMode, opts?: { shift?: boolean }) => {
    const slot = page * 8 + index
    if (mode === 'hotcue' || mode === 'sampler') {
      setHotCues((prev) => {
        const cue = prev[slot]
        if (opts?.shift && cue.time != null) return prev.map((c, i) => (i === slot ? { time: null } : c))
        if (cue.time == null) return prev.map((c, i) => (i === slot ? { time: yt.currentTime } : c))
        yt.seekTo(cue.time)
        if (!yt.isPlaying) yt.play()
        return prev
      })
      return
    }
    if (mode === 'beatloop') { setAutoLoop(LOOP_LENGTHS[index]); return }
    if (mode === 'beatjump') {
      const isBack = index < 4
      const size = Math.pow(2, index % 4)
      beatJump((isBack ? -1 : 1) * size)
      return
    }
    // padfx/keyboard: no aplican a un video de YouTube (no hay buffer que retocar)
  }, [page, yt, setAutoLoop, beatJump])
  const padFxDown = useCallback((_index: number) => {}, [])
  const padFxUp = useCallback(() => {}, [])
  const clearHotCues = useCallback(() => setHotCues(Array.from({ length: HOTCUE_SLOTS }, () => ({ time: null }))), [])

  // Loop real por seekTo: cuando se pasa del final del loop, vuelve al inicio
  useEffect(() => {
    if (!loop.active || loop.start == null || loop.end == null) return
    if (yt.currentTime >= loop.end) yt.seekTo(loop.start)
  }, [loop, yt])

  const loadFile = useCallback((_file: File, _opts?: { persist?: boolean; onLoaded?: () => void }) => {}, [])
  const loadTrack = useCallback((_track: import('./types').Track) => {}, [])

  return {
    trackName: title, isVideoTrack: false, thumbnail: null, getLoadedFile: () => null, isLoading: false, isPlaying: yt.isPlaying, duration: yt.duration, currentTime: yt.currentTime,
    peaks: null, bpm, beatGrid: null, level: 0, spectrum: [],
    pitch, tempoRangePct, trim, eq, colorFxType, colorFxAmount, gain, muted, cueOn, fxSendActive,
    loop, hotCues, page, slip, quantize,
    loadFile, loadTrack, togglePlay, cuePress, seekTo, nudge,
    setGain, setTrim, setEq, setColorFxType, setColorFxAmount, toggleMuted, toggleCue, setFxSendActive,
    setPitch, resetTempo, cycleTempoRange, tapTempo, syncTo,
    setLoopIn, setLoopOut, exitReloop, setAutoLoop, loop4Beats, beatJump,
    triggerPad, releasePad: (_mode: import('./types').PadMode) => {}, padFxDown, padFxUp, clearHotCues, togglePage,
    setSlip, setQuantize,
  }
}

/**
 * Barra inferior: refleja el plato que está sonando (A por defecto, o
 * B si es el que está en play) — play/pause, beat jump, progreso,
 * volumen y favorito son reales sobre ese plato; shuffle/repeat/
 * favorito no tienen backend de playlist real, quedan como estado
 * local (simulación honesta, no hay servicio que inventar).
 */
function MiniPlayer({ deckA, deckB, onOpenSource }: { deckA: DeckEngine; deckB: DeckEngine; onOpenSource: () => void }) {
  const engine = deckA.isPlaying || !deckB.isPlaying ? deckA : deckB
  const color = engine === deckA ? DECK_A : DECK_B
  const [shuffleOn, setShuffleOn] = useState(false)
  const [repeatOn, setRepeatOn] = useState(false)
  const [favorite, setFavorite] = useState(false)

  const dragRef = useRef<{ x: number; value: number } | null>(null)
  const onVolPointerDown = useCallback((e: PointerEvent<HTMLDivElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId)
    dragRef.current = { x: e.clientX, value: engine.gain }
  }, [engine.gain])
  const onVolPointerMove = useCallback((e: PointerEvent<HTMLDivElement>) => {
    if (!dragRef.current) return
    const width = e.currentTarget.getBoundingClientRect().width || 80
    engine.setGain(Math.min(1, Math.max(0, dragRef.current.value + (e.clientX - dragRef.current.x) / width)))
  }, [engine])
  const onVolPointerUp = useCallback(() => { dragRef.current = null }, [])

  return (
    <div className="relative flex items-center gap-4 overflow-hidden rounded-2xl px-5 py-2.5" style={METAL_PANEL}>
      <MetalGrain />
      <div className="relative h-8.5 w-8.5 shrink-0 rounded-md" style={{ background: `linear-gradient(160deg, ${color}, #3a1c66)` }} />
      <div className="min-w-[130px]">
        <div className="flex items-center gap-1 text-[11.5px] font-bold text-white">
          <span className="max-w-[110px] truncate">{engine.trackName ?? 'Sin pista'}</span>
          <button type="button" onClick={() => setFavorite((v) => !v)} aria-label={favorite ? 'Quitar de favoritos' : 'Marcar como favorito'} aria-pressed={favorite} style={{ color: favorite ? color : 'rgba(255,255,255,0.3)' }}>♥</button>
        </div>
        <div className="text-[10px] text-white/40">{engine.isPlaying ? 'Sonando' : 'En pausa'}</div>
      </div>
      <div className="mx-auto flex items-center gap-3.5 text-white/40">
        <button type="button" onClick={() => setShuffleOn((v) => !v)} aria-label="Aleatorio" aria-pressed={shuffleOn} style={shuffleOn ? { color } : undefined}><IconShuffle className="h-3.5 w-3.5" /></button>
        <button type="button" onClick={() => engine.beatJump(-8)} aria-label="Retroceder"><IconSkipBack className="h-3.5 w-3.5" /></button>
        <button
          type="button"
          onClick={engine.togglePlay}
          aria-label={engine.isPlaying ? 'Pausar' : 'Reproducir'}
          className="flex h-[26px] w-[26px] items-center justify-center rounded-full border border-white text-white"
        >
          {engine.isPlaying ? <IconPause className="h-3 w-3" /> : <IconPlay className="h-3 w-3" />}
        </button>
        <button type="button" onClick={() => engine.beatJump(8)} aria-label="Avanzar"><IconSkipForward className="h-3.5 w-3.5" /></button>
        <span className="font-mono text-[10px] text-white/30">{fmtTime(engine.currentTime)} / {fmtTime(engine.duration)}</span>
        <button type="button" onClick={() => setRepeatOn((v) => !v)} aria-label="Repetir" aria-pressed={repeatOn} style={repeatOn ? { color } : undefined}><IconRepeat className="h-3.5 w-3.5" /></button>
      </div>
      <div className="flex items-center gap-3.5 text-white/40">
        <button type="button" onClick={onOpenSource} aria-label="Abrir en pantalla principal"><IconWindow className="h-4 w-4" /></button>
        <IconVolume className="h-4 w-4" />
        <div
          className="relative h-[2px] w-20 touch-none rounded bg-white/10"
          onPointerDown={onVolPointerDown}
          onPointerMove={onVolPointerMove}
          onPointerUp={onVolPointerUp}
          onPointerCancel={onVolPointerUp}
          style={{ paddingBlock: 8, marginBlock: -8, cursor: 'pointer' }}
        >
          <div className="pointer-events-none absolute inset-y-0 left-0 rounded" style={{ width: `${engine.gain * 100}%`, background: color }} />
        </div>
        <button
          type="button"
          onClick={() => { try { document.documentElement.requestFullscreen?.() } catch { /* el navegador puede bloquear fullscreen sin gesto directo */ } }}
          aria-label="Pantalla completa"
        >
          <IconExpand className="h-4 w-4" />
        </button>
      </div>
    </div>
  )
}

export function DjIaScreen() {
  const audio = useAudioEngine()
  const fxBus = useMemo(() => audio.ctx.createGain(), [audio.ctx])
  // Etapa 5 — solo para el historial y las colas reales (ver
  // `migrateLegacyDjIaKey` más arriba); sin cuenta, un visitante usa
  // un balde compartido "guest" (mismo criterio que
  // `musicIntelligence/profile.ts`) — DJ IA no pasa a requerir sesión.
  const auth = useAuth()
  const djiaAccountKey = auth.accountId ?? 'guest'

  // --- Asistente DJ IA: activación general + modos reales que ---
  // ajustan parámetros de verdad del motor (no solo una etiqueta).
  const [djiaActive, setDjiaActive] = useState(() => readLS('dj-ia:djiaActive', false))
  const [energyMode, setEnergyMode] = useState<EnergyMode>(() => readLS('dj-ia:energyMode', 'normal' as EnergyMode))
  const [cleanMode, setCleanMode] = useState(() => readLS('dj-ia:cleanMode', false))
  const [smartVolume, setSmartVolume] = useState(() => readLS('dj-ia:smartVolume', false))
  const [isLive, setIsLive] = useState(() => readLS('dj-ia:isLive', false))
  useEffect(() => { persisted('dj-ia:djiaActive', djiaActive) }, [djiaActive])
  // MABRIONA MUSIC LEARNING ENGINE — registra la sesión (sección 11), sin tocar el motor de audio.
  const djiaActiveWasRef = useRef(djiaActive)
  useEffect(() => {
    if (djiaActive && !djiaActiveWasRef.current) logDjSessionStarted()
    if (!djiaActive && djiaActiveWasRef.current) logDjSessionEnded()
    djiaActiveWasRef.current = djiaActive
  }, [djiaActive])
  useEffect(() => { persisted('dj-ia:energyMode', energyMode) }, [energyMode])
  useEffect(() => { persisted('dj-ia:cleanMode', cleanMode) }, [cleanMode])
  useEffect(() => { persisted('dj-ia:smartVolume', smartVolume) }, [smartVolume])
  useEffect(() => { persisted('dj-ia:isLive', isLive) }, [isLive])

  const deckA = useDeckEngine(audio.ctx, audio.crossfadeA, audio.cueBus, fxBus, 'deckA', smartVolume)
  const deckB = useDeckEngine(audio.ctx, audio.crossfadeB, audio.cueBus, fxBus, 'deckB', smartVolume)

  // Modo energía real: mientras el Asistente está activo, mueve el
  // nivel real del master (no decorativo) — vuelve a 0.9 (default de
  // fábrica del motor) en cuanto se apaga el Asistente, para no dejar
  // pisado un ajuste que el usuario no ve de dónde salió.
  useEffect(() => {
    audio.setMasterLevel(djiaActive ? ENERGY_MASTER_LEVEL[energyMode] : 0.9)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [djiaActive, energyMode])

  // Historial real: cada vez que un plato real arranca a sonar una
  // pista distinta a la última que ya quedó anotada, se agrega arriba
  // de todo — no se vuelve a anotar por pausar/seguir la misma. Cubre
  // mezcla manual y Mezcla Automática (los dos usan deckA/deckB); los
  // videos de YouTube quedan afuera del historial, igual que del resto
  // de las funciones que necesitan audio real.
  const [history, setHistory] = useState<{ name: string; at: number }[]>(() => {
    if (auth.accountId) migrateLegacyDjIaKey('dj-ia:history', auth.accountId)
    return readLS(`dj-ia:history:${djiaAccountKey}`, [] as { name: string; at: number }[])
  })
  useEffect(() => { persisted(`dj-ia:history:${djiaAccountKey}`, history) }, [history, djiaAccountKey])
  const lastLoggedARef = useRef<string | null>(null)
  const lastLoggedBRef = useRef<string | null>(null)
  useEffect(() => {
    if (deckA.isPlaying && deckA.trackName && deckA.trackName !== lastLoggedARef.current) {
      lastLoggedARef.current = deckA.trackName
      setHistory((prev) => [{ name: deckA.trackName as string, at: Date.now() }, ...prev].slice(0, 50))
    }
  }, [deckA.isPlaying, deckA.trackName])
  useEffect(() => {
    if (deckB.isPlaying && deckB.trackName && deckB.trackName !== lastLoggedBRef.current) {
      lastLoggedBRef.current = deckB.trackName
      setHistory((prev) => [{ name: deckB.trackName as string, at: Date.now() }, ...prev].slice(0, 50))
    }
  }, [deckB.isPlaying, deckB.trackName])
  const clearHistory = useCallback(() => setHistory([]), [])

  // --- Mezcla Automática: cola real de audio de la Biblioteca que se
  // va mezclando sola entre los dos platos (ver AutoMixView arriba). ---
  const [autoMixQueue, setAutoMixQueue] = useState<AutoMixTrack[]>(() => {
    if (auth.accountId) migrateLegacyDjIaKey('dj-ia:automixQueue', auth.accountId)
    return readLS(`dj-ia:automixQueue:${djiaAccountKey}`, [] as AutoMixTrack[])
  })
  const [autoMixIndex, setAutoMixIndex] = useState(0)
  const [autoMixActiveDeck, setAutoMixActiveDeck] = useState<'a' | 'b'>('a')
  const [autoMixOn, setAutoMixOn] = useState(false)
  const [autoMixTransitioning, setAutoMixTransitioning] = useState(false)
  const [autoMixStatus, setAutoMixStatus] = useState('')
  const autoMixTickRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const autoMixRafRef = useRef<number | null>(null)
  const beginAutoMixTransitionRef = useRef<() => void>(() => {})
  // "Última foto" de todo lo que el temporizador/la transición
  // necesitan leer al momento real de disparar — deckA/deckB son
  // objetos nuevos en cada render, así que una closure vieja los
  // leería congelados; esta ref siempre tiene la versión de ahora.
  const autoMixLiveRef = useRef({ deckA, deckB, transitioning: autoMixTransitioning, activeDeck: autoMixActiveDeck, queue: autoMixQueue, energyMode })
  autoMixLiveRef.current = { deckA, deckB, transitioning: autoMixTransitioning, activeDeck: autoMixActiveDeck, queue: autoMixQueue, energyMode }

  useEffect(() => { persisted(`dj-ia:automixQueue:${djiaAccountKey}`, autoMixQueue) }, [autoMixQueue, djiaAccountKey])

  const ensurePlaying = (e: DeckEngine) => { if (!e.isPlaying) e.togglePlay() }
  const ensurePaused = (e: DeckEngine) => { if (e.isPlaying) e.togglePlay() }

  const runAutoMixCrossfade = useCallback((fromSide: 'a' | 'b', onDone: () => void) => {
    const start = performance.now()
    const fromVal = fromSide === 'a' ? -1 : 1
    const toVal = fromSide === 'a' ? 1 : -1
    const durationMs = ENERGY_TRANSITION_SECONDS[autoMixLiveRef.current.energyMode] * 1000
    const step = (now: number) => {
      const t = Math.min(1, (now - start) / durationMs)
      audio.setCrossfaderValue(fromVal + (toVal - fromVal) * t)
      if (t < 1) { autoMixRafRef.current = requestAnimationFrame(step) }
      else { autoMixRafRef.current = null; onDone() }
    }
    autoMixRafRef.current = requestAnimationFrame(step)
  }, [audio])

  const beginAutoMixTransition = useCallback(() => {
    const { deckA: liveA, deckB: liveB, transitioning, activeDeck, queue } = autoMixLiveRef.current
    if (transitioning || queue.length < 2) return
    const activeEngine = activeDeck === 'a' ? liveA : liveB
    const idleEngine = activeDeck === 'a' ? liveB : liveA
    const nextIndex = (autoMixIndex + 1) % queue.length
    const nextTrack = queue[nextIndex]
    if (!nextTrack) return
    setAutoMixTransitioning(true)
    setAutoMixStatus(`Cargando "${nextTrack.name}"…`)
    void loadAutoMixTrack(nextTrack.key).then((file) => {
      if (!file) { setAutoMixStatus(`No se pudo abrir "${nextTrack.name}"`); setAutoMixTransitioning(false); return }
      idleEngine.loadFile(file, {
        persist: false,
        onLoaded: () => {
          // Beatmatch real: la pista que entra ajusta su tempo real
          // (playbackRate) al BPM real de la que ya está sonando —
          // mismo primitivo `syncTo` que usa el botón SYNC manual.
          if (activeEngine.bpm) idleEngine.syncTo(activeEngine.bpm)
          ensurePlaying(idleEngine)
          setAutoMixStatus(`Mezclando a "${nextTrack.name}"…`)
          runAutoMixCrossfade(activeDeck, () => {
            ensurePaused(activeEngine)
            activeEngine.resetTempo()
            setAutoMixActiveDeck(activeDeck === 'a' ? 'b' : 'a')
            setAutoMixIndex(nextIndex)
            setAutoMixTransitioning(false)
            setAutoMixStatus(`Sonando "${nextTrack.name}"`)
          })
        },
      })
    })
  }, [autoMixIndex, runAutoMixCrossfade])
  useEffect(() => { beginAutoMixTransitionRef.current = beginAutoMixTransition }, [beginAutoMixTransition])

  // Vigía real: cada medio segundo mira cuánto le queda a la pista que
  // suena — cuando falta lo mismo que dura el cruce, dispara la
  // transición sola. Un único intervalo por corrida (no se recrea en
  // cada render) leyendo siempre el estado más nuevo por la ref de
  // arriba, para no perder ticks ni duplicar temporizadores.
  useEffect(() => {
    if (!autoMixOn) return
    const id = setInterval(() => {
      const { deckA: liveA, deckB: liveB, transitioning, activeDeck, queue, energyMode: liveEnergy } = autoMixLiveRef.current
      if (transitioning || queue.length < 2) return
      const activeEngine = activeDeck === 'a' ? liveA : liveB
      if (!activeEngine.isPlaying || !activeEngine.duration) return
      const remaining = activeEngine.duration - activeEngine.currentTime
      if (remaining <= ENERGY_TRANSITION_SECONDS[liveEnergy]) beginAutoMixTransitionRef.current()
    }, 500)
    autoMixTickRef.current = id
    return () => clearInterval(id)
  }, [autoMixOn])

  useEffect(() => () => {
    if (autoMixTickRef.current) clearInterval(autoMixTickRef.current)
    if (autoMixRafRef.current) cancelAnimationFrame(autoMixRafRef.current)
  }, [])

  const addAutoMixFiles = useCallback((files: FileList) => {
    Array.from(files).forEach((file, i) => {
      const key = `automix-${Date.now().toString(36)}-${i}-${Math.random().toString(36).slice(2, 6)}`
      void saveAutoMixTrack(key, file)
      setAutoMixQueue((prev) => [...prev, { key, name: file.name.replace(/\.[^./]+$/, ''), bpm: null }])
    })
  }, [])
  // Fase X — una pista del catálogo propio de MUSIC entra a la cola de
  // Mezcla Automática por el MISMO camino que un archivo elegido a
  // mano: se arma un FileList real de un solo elemento y se reusa
  // `addAutoMixFiles` tal cual, sin duplicar su lógica. `addAutoMixFiles`
  // toma el nombre de la cola de `file.name` — acá se reconstruye el
  // `File` con el título real de la pista (mismo contenido/blob) para
  // que la cola muestre el título de MUSIC en vez del nombre interno
  // del archivo guardado en IndexedDB.
  const addCatalogFileToAutoMix = useCallback((file: File, title: string) => {
    const named = new File([file], `${title}.${(file.name.split('.').pop() || 'mp3')}`, { type: file.type })
    const dt = new DataTransfer()
    dt.items.add(named)
    addAutoMixFiles(dt.files)
  }, [addAutoMixFiles])
  const removeAutoMixTrack = useCallback((i: number) => {
    setAutoMixQueue((prev) => prev.filter((_, idx) => idx !== i))
  }, [])
  const moveAutoMixTrack = useCallback((i: number, dir: -1 | 1) => {
    const j = i + dir
    setAutoMixQueue((prev) => {
      if (j < 0 || j >= prev.length) return prev
      const copy = [...prev]
      ;[copy[i], copy[j]] = [copy[j], copy[i]]
      return copy
    })
  }, [])
  const clearAutoMixQueue = useCallback(() => setAutoMixQueue([]), [])

  const startAutoMix = useCallback(() => {
    if (autoMixOn || autoMixQueue.length < 2) return
    const first = autoMixQueue[0]
    setAutoMixIndex(0)
    setAutoMixActiveDeck('a')
    audio.setCrossfaderValue(-1)
    setAutoMixStatus(`Cargando "${first.name}"…`)
    void loadAutoMixTrack(first.key).then((file) => {
      if (!file) { setAutoMixStatus(`No se pudo abrir "${first.name}"`); return }
      deckA.loadFile(file, {
        persist: false,
        onLoaded: () => { ensurePlaying(deckA); setAutoMixStatus(`Sonando "${first.name}"`); setAutoMixOn(true) },
      })
    })
  }, [autoMixOn, autoMixQueue, audio, deckA])

  const stopAutoMix = useCallback(() => {
    setAutoMixOn(false)
    setAutoMixTransitioning(false)
    if (autoMixRafRef.current) { cancelAnimationFrame(autoMixRafRef.current); autoMixRafRef.current = null }
    ensurePaused(deckA)
    ensurePaused(deckB)
    setAutoMixStatus('')
  }, [deckA, deckB])

  const skipAutoMix = useCallback(() => {
    if (!autoMixOn || autoMixTransitioning) return
    beginAutoMixTransition()
  }, [autoMixOn, autoMixTransitioning, beginAutoMixTransition])

  // --- Detección de silencio real: el AnalyserNode del master (el
  // mismo que ya usa el VU real del mezclador) — si algún plato de la
  // Biblioteca dice estar sonando pero el nivel real del master se
  // queda en silencio más de la cuenta, salta sola a la siguiente
  // canción de la Mezcla Automática (si estaba corriendo). YouTube
  // queda afuera: su audio no pasa por este AnalyserNode (el iframe
  // suena directo, no por el grafo de Web Audio), mismo límite ya
  // documentado en el resto de la pantalla. ---
  const [silenceAlert, setSilenceAlert] = useState(false)
  const silenceSinceRef = useRef<number | null>(null)
  const skipAutoMixRef = useRef<() => void>(() => {})
  useEffect(() => { skipAutoMixRef.current = skipAutoMix }, [skipAutoMix])
  useEffect(() => {
    const buf = new Uint8Array(audio.masterAnalyser.fftSize)
    const id = setInterval(() => {
      const shouldBeSounding = deckA.isPlaying || deckB.isPlaying
      if (!shouldBeSounding) { silenceSinceRef.current = null; setSilenceAlert(false); return }
      audio.masterAnalyser.getByteTimeDomainData(buf)
      let sum = 0
      for (let i = 0; i < buf.length; i++) { const v = (buf[i] - 128) / 128; sum += v * v }
      const rms = Math.sqrt(sum / buf.length)
      if (rms < 0.02) {
        if (silenceSinceRef.current == null) silenceSinceRef.current = Date.now()
        else if (Date.now() - silenceSinceRef.current > 8000) {
          setSilenceAlert(true)
          if (autoMixOn) skipAutoMixRef.current()
        }
      } else {
        silenceSinceRef.current = null
        setSilenceAlert(false)
      }
    }, 1000)
    return () => clearInterval(id)
  }, [audio.masterAnalyser, deckA.isPlaying, deckB.isPlaying, autoMixOn])

  // --- Programación por hora/día: arranca sola la Mezcla Automática o
  // la Lista de canciones a la hora que se elija, los días que se
  // elijan — reloj real, revisado cada 15s, dispara una sola vez por
  // día para no repetirse dentro del mismo minuto. ---
  const [schedule, setSchedule] = useState<ScheduleConfig>(() => readLS('dj-ia:schedule', { enabled: false, days: [1, 2, 3, 4, 5], time: '18:00', target: 'mezcla' } as ScheduleConfig))
  const onScheduleChange = useCallback((patch: Partial<ScheduleConfig>) => setSchedule((prev) => ({ ...prev, ...patch })), [])
  useEffect(() => { persisted('dj-ia:schedule', schedule) }, [schedule])
  const scheduleFiredRef = useRef<string | null>(null)
  const scheduleLiveRef = useRef(schedule)
  scheduleLiveRef.current = schedule
  const startAutoMixRef = useRef<() => void>(() => {})
  const startYtAutoRef = useRef<() => void>(() => {})
  useEffect(() => { startAutoMixRef.current = startAutoMix }, [startAutoMix])
  useEffect(() => {
    const id = setInterval(() => {
      const s = scheduleLiveRef.current
      if (!s.enabled) return
      const now = new Date()
      const hhmm = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`
      const todayKey = now.toDateString()
      if (s.days.includes(now.getDay()) && hhmm === s.time && scheduleFiredRef.current !== todayKey) {
        scheduleFiredRef.current = todayKey
        if (s.target === 'mezcla') startAutoMixRef.current()
        else startYtAutoRef.current()
      }
    }, 15000)
    return () => clearInterval(id)
  }, [])

  const [videoTab, setVideoTab] = useState<VideoTab>(() => readLS('dj-ia:videoTab', 'SOURCE' as VideoTab))
  const [screenBrightness, setScreenBrightness] = useState(() => readLS('dj-ia:screenBrightness', 1))
  const [waveformDetail, setWaveformDetail] = useState<'full' | 'simple'>(() => readLS('dj-ia:waveformDetail', 'full' as const))
  const [waveformMono, setWaveformMono] = useState(() => readLS('dj-ia:waveformMono', false))
  const [jogSensA, setJogSensA] = useState(() => readLS('dj-ia:jogSensA', 1))
  const [jogSensB, setJogSensB] = useState(() => readLS('dj-ia:jogSensB', 1))
  // Cada plato tiene su PROPIO video de YouTube, real e independiente
  // (dos instancias de la IFrame API, no una compartida) — cargar un
  // video nuevo en el Plato 2 ya NO apaga ni desconecta el que está
  // sonando en el Plato 1. Pedido explícito: "la canción debe seguir
  // sonando, solo el usuario debe cambiarla o pararla".
  const [ytVideoId1, setYtVideoId1] = useState<string | null>(() => readLS('dj-ia:ytVideoId1', null))
  const [ytTitle1, setYtTitle1] = useState<string | null>(() => readLS('dj-ia:ytTitle1', null))
  const ytPlayer1 = useYoutubePlayer(ytVideoId1)
  const ytEngine1 = useYoutubeDeckEngine(ytTitle1 ?? 'Video de YouTube', ytPlayer1)
  const ytOverride1: YtOverride | null = ytVideoId1
    ? { videoId: ytVideoId1, isPlaying: ytPlayer1.isPlaying, currentTime: ytPlayer1.currentTime, duration: ytPlayer1.duration, title: ytTitle1 ?? 'Video de YouTube', status: ytPlayer1.status, error: ytPlayer1.error, bpm: ytEngine1.bpm }
    : null

  const [ytVideoId2, setYtVideoId2] = useState<string | null>(() => readLS('dj-ia:ytVideoId2', null))
  const [ytTitle2, setYtTitle2] = useState<string | null>(() => readLS('dj-ia:ytTitle2', null))
  const ytPlayer2 = useYoutubePlayer(ytVideoId2)
  const ytEngine2 = useYoutubeDeckEngine(ytTitle2 ?? 'Video de YouTube', ytPlayer2)
  const ytOverride2: YtOverride | null = ytVideoId2
    ? { videoId: ytVideoId2, isPlaying: ytPlayer2.isPlaying, currentTime: ytPlayer2.currentTime, duration: ytPlayer2.duration, title: ytTitle2 ?? 'Video de YouTube', status: ytPlayer2.status, error: ytPlayer2.error, bpm: ytEngine2.bpm }
    : null

  // Qué video se ve en la PANTALLA (SOURCE) — el último que se tocó,
  // nada más que un puntero de foco visual. El audio de los dos
  // platos sigue sonando siempre, se vea o no en pantalla.
  const [ytFocusDeck, setYtFocusDeck] = useState<1 | 2 | null>(() => readLS('dj-ia:ytFocusDeck', null))
  const ytVideoId = ytFocusDeck === 2 ? ytVideoId2 : ytFocusDeck === 1 ? ytVideoId1 : null
  const ytTitle = ytFocusDeck === 2 ? ytTitle2 : ytFocusDeck === 1 ? ytTitle1 : null
  const ytPlayer = ytFocusDeck === 2 ? ytPlayer2 : ytPlayer1
  const deckAEngine = ytVideoId1 ? ytEngine1 : deckA
  const deckBEngine = ytVideoId2 ? ytEngine2 : deckB

  // Cargar un archivo local a un plato que tenía un video de YouTube
  // asignado no alcanza con `deckX.loadFile(file)` solo — mientras
  // `ytVideoId1`/`ytVideoId2` siga puesto, `deckAEngine`/`deckBEngine`
  // (arriba) siguen apuntando al motor de YouTube, así que el archivo
  // recién cargado queda invisible en pantalla y en la mezcla. Hay que
  // sacar el video de ese plato primero.
  // Fase 12 — Memory Cues reales: qué track de la Library (si alguno)
  // está cargado en cada plato ahora mismo, para saber a qué registro
  // real persistirle los Hot Cues cuando cambian. `null` = el archivo
  // no vino de la Library (selector de archivo suelto / puente MUSIC),
  // así que no hay identidad estable a la que guardarle nada.
  const [libraryTrackId1, setLibraryTrackId1] = useState<string | null>(null)
  const [libraryTrackId2, setLibraryTrackId2] = useState<string | null>(null)

  const loadLocalFileToDeck = useCallback((deck: 1 | 2, file: File, knownBpm?: number, knownBeatGrid?: import('./types').BeatGrid, knownHotCues?: import('./types').HotCue[] | null, libraryTrackId?: string | null) => {
    if (deck === 1) { setYtVideoId1(null); setYtTitle1(null); if (ytFocusDeck === 1) setYtFocusDeck(null); setLibraryTrackId1(libraryTrackId ?? null) }
    else { setYtVideoId2(null); setYtTitle2(null); if (ytFocusDeck === 2) setYtFocusDeck(null); setLibraryTrackId2(libraryTrackId ?? null) }
    ;(deck === 1 ? deckA : deckB).loadFile(file, { knownBpm, knownBeatGrid, knownHotCues })
  }, [deckA, deckB, ytFocusDeck])

  // Transición de video real (CSS, transforma los elementos de
  // verdad) al cambiar cuál plato se ve en pantalla — el que se va
  // corre la animación "-out", el que entra "-in", los dos al mismo
  // tiempo, igual que un mezclador de video real.
  const [videoTransitionType, setVideoTransitionType] = useState<VideoTransitionType>(() => readLS('dj-ia:videoTransitionType', 'fade' as VideoTransitionType))
  const [ytLeavingDeck, setYtLeavingDeck] = useState<1 | 2 | null>(null)
  const videoTransitionTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => { persisted('dj-ia:videoTransitionType', videoTransitionType) }, [videoTransitionType])
  const switchYtFocus = useCallback((deck: 1 | 2) => {
    setYtFocusDeck((prev) => {
      if (prev === deck) return prev
      if (prev != null) {
        setYtLeavingDeck(prev)
        if (videoTransitionTimeoutRef.current) clearTimeout(videoTransitionTimeoutRef.current)
        videoTransitionTimeoutRef.current = setTimeout(() => setYtLeavingDeck(null), 650)
      }
      return deck
    })
  }, [])

  // --- Lista Automática por Género: busca de verdad en YouTube la
  // cantidad pedida de cada género, arma una cola mezclada y la pone a
  // sonar sola — sin beatmatching (YouTube no tiene audio accesible
  // para eso), a diferencia de la Mezcla Automática de Biblioteca. ---
  const [genreMix, setGenreMix] = useState<GenreMixRow[]>(() => readLS('dj-ia:genreMix', DEFAULT_GENRE_MIX))
  const [ytAutoQueue, setYtAutoQueue] = useState<YtQueueTrack[]>(() => {
    if (auth.accountId) migrateLegacyDjIaKey('dj-ia:ytAutoQueue', auth.accountId)
    return readLS(`dj-ia:ytAutoQueue:${djiaAccountKey}`, [] as YtQueueTrack[])
  })
  const [ytAutoIndex, setYtAutoIndex] = useState(-1)
  const [ytAutoOn, setYtAutoOn] = useState(false)
  const [genreGenerating, setGenreGenerating] = useState(false)
  const [ytAutoStatus, setYtAutoStatus] = useState('')
  const ytAutoplayNextRef = useRef(false)
  useEffect(() => { persisted('dj-ia:genreMix', genreMix) }, [genreMix])
  useEffect(() => { persisted(`dj-ia:ytAutoQueue:${djiaAccountKey}`, ytAutoQueue) }, [ytAutoQueue, djiaAccountKey])

  // Etapa 5 — al cambiar de cuenta (login/logout/otra cuenta) en la
  // misma sesión de DJ IA, se vuelve a leer el historial/colas de la
  // cuenta nueva en vez de seguir mostrando (y, peor, pudiendo seguir
  // escribiendo) los de la cuenta anterior. `didMountRef` evita
  // pisar la lectura inicial (ya hecha en cada `useState`) con una
  // segunda lectura redundante en el primer render.
  const djiaAccountMountedRef = useRef(false)
  useEffect(() => {
    if (!djiaAccountMountedRef.current) {
      djiaAccountMountedRef.current = true
      return
    }
    if (auth.accountId) {
      migrateLegacyDjIaKey('dj-ia:history', auth.accountId)
      migrateLegacyDjIaKey('dj-ia:automixQueue', auth.accountId)
      migrateLegacyDjIaKey('dj-ia:ytAutoQueue', auth.accountId)
    }
    setHistory(readLS(`dj-ia:history:${djiaAccountKey}`, []))
    setAutoMixQueue(readLS(`dj-ia:automixQueue:${djiaAccountKey}`, []))
    setYtAutoQueue(readLS(`dj-ia:ytAutoQueue:${djiaAccountKey}`, []))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [djiaAccountKey])

  const onUpdateGenreRow = useCallback((i: number, patch: Partial<GenreMixRow>) => {
    setGenreMix((prev) => prev.map((r, idx) => (idx === i ? { ...r, ...patch } : r)))
  }, [])
  const onAddGenreRow = useCallback(() => setGenreMix((prev) => [...prev, { genre: '', count: 2 }]), [])
  const onRemoveGenreRow = useCallback((i: number) => setGenreMix((prev) => prev.filter((_, idx) => idx !== i)), [])
  const onResetGenres = useCallback(() => setGenreMix(DEFAULT_GENRE_MIX), [])

  const onGenerateGenreQueue = useCallback(async () => {
    setGenreGenerating(true)
    setYtAutoStatus('Generando lista…')
    const collected: (YtQueueTrack & { genre: string })[] = []
    for (const row of genreMix) {
      if (!row.genre.trim() || row.count <= 0) continue
      const genre = row.genre.trim()
      try {
        const url = `/api/search?q=${encodeURIComponent(genre)}${cleanMode ? '&safe=1' : ''}`
        const r = await fetchConReintentos(url)
        if (r.ok) {
          const data = await r.json()
          const items: { id: string; title: string }[] = data.items ?? []
          collected.push(...items.slice(0, row.count).map((it) => ({ id: it.id, title: it.title, genre })))
        }
      } catch { /* ese género se salta — no se inventa nada en su lugar */ }
    }
    // Orden final: baraja ponderada por el gusto real del usuario (MABRIONA MUSIC LEARNING ENGINE, perfil
    // compartido con MUSIC) — sigue siendo aleatoria (nunca queda todo un género pegado ni siempre el mismo
    // orden), pero un género que ya le gusta tiene más chance de salir antes. Sin señal todavía, pesos parejos
    // = mismo shuffle simple de siempre.
    const weights = getGenreWeights(readProfile(), genreMix.map((r) => r.genre.trim()).filter(Boolean))
    const ordered = weightedShuffle(collected, (t) => weights[t.genre] ?? 1).map(({ id, title }) => ({ id, title }))
    setYtAutoQueue(ordered)
    setYtAutoIndex(-1)
    setGenreGenerating(false)
    setYtAutoStatus(collected.length > 0 ? `Lista lista: ${collected.length} canciones` : 'No se encontró nada — revisá la conexión con YouTube')
  }, [genreMix, cleanMode])

  // La Lista Automática/Mezcla por género siempre usa el Plato 1 — así
  // el Plato 2 queda siempre libre para uso manual independiente, sin
  // que la cola se lo pise.
  const playYtAutoIndex = useCallback((i: number) => {
    const track = ytAutoQueue[i]
    if (!track) return
    ytAutoplayNextRef.current = true
    setYtAutoIndex(i)
    setYtAutoOn(true) // tocar cualquier canción de la lista también retoma el avance automático desde ahí
    setYtVideoId1(track.id)
    setYtTitle1(track.title)
    setYtFocusDeck(1)
    setVideoTab('SOURCE')
  }, [ytAutoQueue])

  const onStartYtAuto = useCallback(() => {
    if (ytAutoQueue.length === 0) return
    setYtAutoOn(true)
    playYtAutoIndex(ytAutoIndex >= 0 ? ytAutoIndex : 0)
  }, [ytAutoQueue, ytAutoIndex, playYtAutoIndex])
  useEffect(() => { startYtAutoRef.current = onStartYtAuto }, [onStartYtAuto])

  const onStopYtAuto = useCallback(() => {
    setYtAutoOn(false)
    if (ytPlayer1.isPlaying) ytPlayer1.pause()
  }, [ytPlayer1])

  const onAdvanceYtAuto = useCallback(() => {
    if (ytAutoQueue.length === 0) return
    const next = ytAutoIndex + 1 >= ytAutoQueue.length ? 0 : ytAutoIndex + 1
    playYtAutoIndex(next)
  }, [ytAutoIndex, ytAutoQueue, playYtAutoIndex])

  // Armar la lista a mano, una canción a la vez, desde el buscador de
  // arriba ("Agregar → Agregar a la lista") — comparte la cola con la
  // Lista Automática por Género, así las dos formas de armarla (a mano
  // o generada) terminan en el mismo lugar.
  const addToYtAutoQueue = useCallback((id: string, title: string) => {
    setYtAutoQueue((prev) => [...prev, { id, title }])
  }, [])
  const removeYtAutoTrack = useCallback((i: number) => {
    setYtAutoQueue((prev) => prev.filter((_, idx) => idx !== i))
    setYtAutoIndex((prev) => (i < prev ? prev - 1 : prev === i ? -1 : prev))
  }, [])
  const moveYtAutoTrack = useCallback((i: number, dir: -1 | 1) => {
    const j = i + dir
    setYtAutoQueue((prev) => {
      if (j < 0 || j >= prev.length) return prev
      const copy = [...prev]
      ;[copy[i], copy[j]] = [copy[j], copy[i]]
      return copy
    })
    setYtAutoIndex((prev) => (prev === i ? j : prev === j ? i : prev))
  }, [])

  const ytAutoLiveRef = useRef({ ytPlayer: ytPlayer1 })
  ytAutoLiveRef.current = { ytPlayer: ytPlayer1 }
  const onAdvanceYtAutoRef = useRef<() => void>(() => {})
  useEffect(() => { onAdvanceYtAutoRef.current = onAdvanceYtAuto }, [onAdvanceYtAuto])

  useEffect(() => {
    if (ytAutoOn && ytPlayer1.status === 'listo' && ytAutoplayNextRef.current) {
      ytAutoplayNextRef.current = false
      ytPlayer1.play()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ytAutoOn, ytPlayer1.status, ytPlayer1.play])

  useEffect(() => {
    if (!ytAutoOn) return
    const id = setInterval(() => {
      const { ytPlayer: p } = ytAutoLiveRef.current
      if (!p.isPlaying || !p.duration) return
      if (p.duration - p.currentTime <= 1) onAdvanceYtAutoRef.current()
    }, 500)
    return () => clearInterval(id)
  }, [ytAutoOn])

  // CH3/CH4 del mezclador no tienen plato real detrás (la app solo
  // tiene 2 decks) — quedan con su propio estado local, interactivo
  // de verdad (arrastrar mueve el fader/perilla) pero sin pretender
  // procesar un audio que no existe.
  const [ch3, setCh3] = useState<ChannelState>(() => readLS('dj-ia:ch3', DEFAULT_CHANNEL_STATE))
  const [ch4, setCh4] = useState<ChannelState>(() => readLS('dj-ia:ch4', DEFAULT_CHANNEL_STATE))
  const [mic1On, setMic1On] = useState(() => readLS('dj-ia:mic1On', false))
  const [mic2On, setMic2On] = useState(() => readLS('dj-ia:mic2On', false))
  const [mic1Level, setMic1Level] = useState(() => readLS('dj-ia:mic1Level', 0))
  const [mic2Level, setMic2Level] = useState(() => readLS('dj-ia:mic2Level', 0))
  const [talkoverOn, setTalkoverOn] = useState(() => readLS('dj-ia:talkoverOn', false))
  const [xfAssignA, setXfAssignA] = useState<'A' | 'THRU' | 'B'>(() => readLS('dj-ia:xfAssignA', 'A'))
  const [xfAssignB, setXfAssignB] = useState<'A' | 'THRU' | 'B'>(() => readLS('dj-ia:xfAssignB', 'B'))
  const [soundColorFx, setSoundColorFx] = useState<{ type: ColorFxType; amount: number }>(() => readLS('dj-ia:soundColorFx', { type: 'dubecho' as ColorFxType, amount: 0 }))

  useEffect(() => { persisted('dj-ia:ch3', ch3) }, [ch3])
  useEffect(() => { persisted('dj-ia:ch4', ch4) }, [ch4])
  useEffect(() => { persisted('dj-ia:mic1On', mic1On) }, [mic1On])
  useEffect(() => { persisted('dj-ia:mic2On', mic2On) }, [mic2On])
  useEffect(() => { persisted('dj-ia:mic1Level', mic1Level) }, [mic1Level])
  useEffect(() => { persisted('dj-ia:mic2Level', mic2Level) }, [mic2Level])
  useEffect(() => { persisted('dj-ia:talkoverOn', talkoverOn) }, [talkoverOn])
  useEffect(() => { persisted('dj-ia:xfAssignA', xfAssignA) }, [xfAssignA])
  useEffect(() => { persisted('dj-ia:xfAssignB', xfAssignB) }, [xfAssignB])
  useEffect(() => { persisted('dj-ia:soundColorFx', soundColorFx) }, [soundColorFx])

  const [beatFxExtra, setBeatFxExtra] = useState<[number, number]>(() => readLS('dj-ia:beatFxExtra', [35, 75]))
  const [sourceShuffle, setSourceShuffle] = useState(false)
  const [sourceRepeat, setSourceRepeat] = useState(false)
  useEffect(() => { persisted('dj-ia:beatFxExtra', beatFxExtra) }, [beatFxExtra])

  const crossfaderDragRef = useRef<{ x: number; value: number } | null>(null)
  const onCrossfaderPointerDown = useCallback((e: PointerEvent<HTMLDivElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId)
    crossfaderDragRef.current = { x: e.clientX, value: audio.crossfaderValue }
  }, [audio.crossfaderValue])
  const onCrossfaderPointerMove = useCallback((e: PointerEvent<HTMLDivElement>) => {
    if (!crossfaderDragRef.current) return
    const delta = (e.clientX - crossfaderDragRef.current.x) / 125
    audio.setCrossfaderValue(Math.min(1, Math.max(-1, crossfaderDragRef.current.value + delta)))
  }, [audio])
  const onCrossfaderPointerUp = useCallback(() => { crossfaderDragRef.current = null }, [])

  const beatFxSliderDragRef = useRef<{ x: number; value: number; index: number } | null>(null)
  const onBeatFxSliderDown = useCallback((index: number, currentPct: number) => (e: PointerEvent<HTMLDivElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId)
    beatFxSliderDragRef.current = { x: e.clientX, value: currentPct, index }
  }, [])
  const onBeatFxSliderMove = useCallback((e: PointerEvent<HTMLDivElement>) => {
    const drag = beatFxSliderDragRef.current
    if (!drag) return
    const width = e.currentTarget.getBoundingClientRect().width || 150
    const next = Math.min(100, Math.max(0, drag.value + ((e.clientX - drag.x) / width) * 100))
    if (drag.index === 0) { deckBEngine.setColorFxAmount(next / 100) }
    else setBeatFxExtra((prev) => { const copy: [number, number] = [...prev]; copy[drag.index - 1] = next; return copy })
  }, [deckBEngine])
  const onBeatFxSliderUp = useCallback(() => { beatFxSliderDragRef.current = null }, [])

  useEffect(() => { persisted('dj-ia:videoTab', videoTab) }, [videoTab])
  useEffect(() => { persisted('dj-ia:screenBrightness', screenBrightness) }, [screenBrightness])
  useEffect(() => { persisted('dj-ia:waveformDetail', waveformDetail) }, [waveformDetail])
  useEffect(() => { persisted('dj-ia:waveformMono', waveformMono) }, [waveformMono])
  useEffect(() => { persisted('dj-ia:jogSensA', jogSensA) }, [jogSensA])
  useEffect(() => { persisted('dj-ia:jogSensB', jogSensB) }, [jogSensB])
  useEffect(() => { persisted('dj-ia:ytVideoId1', ytVideoId1) }, [ytVideoId1])
  useEffect(() => { persisted('dj-ia:ytTitle1', ytTitle1) }, [ytTitle1])
  useEffect(() => { persisted('dj-ia:ytVideoId2', ytVideoId2) }, [ytVideoId2])
  useEffect(() => { persisted('dj-ia:ytTitle2', ytTitle2) }, [ytTitle2])
  useEffect(() => { persisted('dj-ia:ytFocusDeck', ytFocusDeck) }, [ytFocusDeck])

  // Compartido entre "Agregar → un plato" y la Biblioteca (cargar una
  // referencia guardada) — mismo efecto real en los dos casos, sin
  // duplicar la lógica de qué estado tocar.
  const loadYoutubeToDeck = (id: string, title: string, deck: 1 | 2) => {
    if (deck === 1) { setYtVideoId1(id); setYtTitle1(title) } else { setYtVideoId2(id); setYtTitle2(title) }
    setYtFocusDeck(deck)
    setVideoTab('SOURCE')
  }

  return (
    <div className="w-full pb-3xl">
      <div className="mx-auto mb-xl w-full max-w-[1600px] px-xl text-center md:px-2xl">
        <h2 className="text-2xl font-bold tracking-wide text-white">DJ IA</h2>
      </div>

      <div className="mx-auto flex w-full max-w-[1600px] flex-col gap-3.5 px-xl pb-2xl md:px-2xl">
          {/* VIDEO PANEL */}
          <div className="relative overflow-hidden rounded-2xl p-4" style={METAL_PANEL}>
            <MetalGrain />
            <div className="relative mb-3 flex flex-wrap items-center justify-between gap-2">
              <span className="text-[10px] font-bold tracking-[0.18em] text-white/40">VIDEO SCREEN</span>
              {(ytVideoId1 || ytVideoId2) && (
                <div className="flex shrink-0 items-center gap-1">
                  {ytVideoId1 && (
                    <button type="button" onClick={() => switchYtFocus(1)} className="rounded-full px-2 py-1 text-[9.5px] font-bold" style={ytFocusDeck === 1 ? raisedActive(DECK_A) : { ...RAISED_BTN, color: 'rgba(255,255,255,0.5)' }} title="Ver y controlar el video del Plato 1">
                    Plato 1
                    </button>
                  )}
                  {ytVideoId2 && (
                    <button type="button" onClick={() => switchYtFocus(2)} className="rounded-full px-2 py-1 text-[9.5px] font-bold" style={ytFocusDeck === 2 ? raisedActive(DECK_B) : { ...RAISED_BTN, color: 'rgba(255,255,255,0.5)' }} title="Ver y controlar el video del Plato 2">
                    Plato 2
                    </button>
                  )}
                  {ytVideoId1 && ytVideoId2 && (
                    <select
                      value={videoTransitionType}
                      onChange={(e) => setVideoTransitionType(e.target.value as VideoTransitionType)}
                      className="rounded-full px-2 py-1 text-[9.5px] font-bold text-white/60 focus:outline-none"
                      style={{ background: '#050608', boxShadow: 'inset 0 1px 3px rgba(0,0,0,0.7), inset 0 0 0 1px rgba(255,255,255,0.08)' }}
                      title="Transición al cambiar de plato en pantalla"
                    >
                      {VIDEO_TRANSITIONS.map((t) => <option key={t.key} value={t.key}>{t.label}</option>)}
                    </select>
                  )}
                </div>
              )}
              <div className="flex min-w-0 flex-1 items-center gap-3.5 text-xs text-white/40">
                {ytTitle && (
                  <span className="flex min-w-0 max-w-[16rem] items-center gap-1.5 truncate">
                    {ytFocusDeck && <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: ytFocusDeck === 1 ? DECK_A : DECK_B }} />}
                    <b className="truncate font-semibold text-white">{ytTitle}</b>
                  </span>
                )}
              </div>
              <AddMenu
                hasVideo={!!ytVideoId1 || !!ytVideoId2}
                onLoadFile={(file, deck) => loadLocalFileToDeck(deck, file)}
                onLoadYoutube={(id, title, deck, meta) => {
                  loadYoutubeToDeck(id, title, deck)
                  addToDjIaLibrary(djiaAccountKey, { id, title, artist: meta?.channel ?? null, thumbnail: meta?.thumbnail ?? null, durationSec: meta?.durationSec ?? null })
                }}
                onAddToList={(id, title, meta) => {
                  addToYtAutoQueue(id, title)
                  addToDjIaLibrary(djiaAccountKey, { id, title, artist: meta?.channel ?? null, thumbnail: meta?.thumbnail ?? null, durationSec: meta?.durationSec ?? null })
                }}
                onRemoveVideo={() => {
                  // Solo saca el video que se está viendo en pantalla ahora — el del otro plato sigue sonando, no se toca.
                  if (ytFocusDeck === 2) { setYtVideoId2(null); setYtTitle2(null) } else { setYtVideoId1(null); setYtTitle1(null) }
                  setYtFocusDeck(null)
                }}
                cleanMode={cleanMode}
                accountId={auth.accountId}
                onAddCatalogToAutoMix={addCatalogFileToAutoMix}
              />
            </div>
            <div
              className="relative flex aspect-[16/7] items-center justify-center overflow-hidden rounded-xl border border-white/[0.08]"
              style={{ background: 'radial-gradient(120% 100% at 25% 20%, rgba(212,255,0,0.06), transparent 60%), linear-gradient(160deg, #1a1c22, #08090b 70%)', filter: `brightness(${screenBrightness})` }}
            >
              {/*
                Los dos reproductores quedan siempre montados (siguen
                sonando aunque no se vean) — al cambiar de plato en
                pantalla, el que se va y el que entra corren la
                transición elegida al mismo tiempo (animación CSS real
                sobre los elementos, no un efecto falso). El div con
                `ref` NO lleva el estilo de la transición: la propia
                API de YouTube lo reemplaza por el <iframe> real ahí
                mismo en cuanto el player arranca (lo saca del árbol),
                así que animar/ocultar ESE div no tendría ningún
                efecto visible — el div de afuera es el que controlo
                yo de verdad, nunca lo toca la API.
              */}
              {ytVideoId1 && (
                <div className="absolute inset-0" style={ytSourcePanelStyle(1, videoTab === 'SOURCE', ytFocusDeck, ytLeavingDeck, videoTransitionType)}>
                  <div ref={ytPlayer1.containerRef} className="h-full w-full" />
                </div>
              )}
              {ytVideoId2 && (
                <div className="absolute inset-0" style={ytSourcePanelStyle(2, videoTab === 'SOURCE', ytFocusDeck, ytLeavingDeck, videoTransitionType)}>
                  <div ref={ytPlayer2.containerRef} className="h-full w-full" />
                </div>
              )}
              {/* Atribución real — este video es de YouTube, MABRIONA solo lo reproduce dentro de su interfaz (sección 11 de la fase). */}
              {videoTab === 'SOURCE' && ytVideoId && (
                <span
                  className="pointer-events-none absolute bottom-2 right-2 z-10 rounded-full px-2 py-0.5 text-[9px] font-bold tracking-wide text-white/70"
                  style={{ background: 'rgba(0,0,0,0.55)' }}
                  aria-hidden="true"
                >
                  Reproduciendo desde YouTube
                </span>
              )}
              {videoTab === 'SOURCE' && !ytVideoId && (
                <div className="flex flex-col items-center gap-2 text-white/25">
                  <IconVideoFrame className="h-8 w-8" />
                  <span className="text-[11px] uppercase tracking-wide">Sin video cargado</span>
                </div>
              )}
              {videoTab === 'RESUMEN' && (
                <SummaryView history={history} deckA={deckAEngine} deckB={deckBEngine} waveformDetail={waveformDetail} waveformMono={waveformMono} />
              )}
              {videoTab === 'AYUDA' && <HelpView />}
              {videoTab === 'CONFIG' && (
                <MenuView
                  deckA={deckAEngine} deckB={deckBEngine} jogSensA={jogSensA} jogSensB={jogSensB}
                  onJogSensA={setJogSensA} onJogSensB={setJogSensB}
                  onClearQueue={clearAutoMixQueue} onClearHistory={clearHistory}
                  brightness={screenBrightness} onBrightness={setScreenBrightness}
                  waveformDetail={waveformDetail} onWaveformDetail={setWaveformDetail}
                  waveformMono={waveformMono} onWaveformMono={() => setWaveformMono((m) => !m)}
                  schedule={schedule} onScheduleChange={onScheduleChange}
                />
              )}
              {videoTab === 'MEZCLA' && (
                <AutoMixView
                  queue={autoMixQueue}
                  currentIndex={autoMixIndex}
                  running={autoMixOn}
                  transitioning={autoMixTransitioning}
                  status={autoMixStatus}
                  onAddFiles={addAutoMixFiles}
                  onRemove={removeAutoMixTrack}
                  onMove={moveAutoMixTrack}
                  onClear={clearAutoMixQueue}
                  onStart={startAutoMix}
                  onStop={stopAutoMix}
                  onSkip={skipAutoMix}
                  genreMix={genreMix}
                  onUpdateGenreRow={onUpdateGenreRow}
                  onAddGenreRow={onAddGenreRow}
                  onRemoveGenreRow={onRemoveGenreRow}
                  onGenerateGenreQueue={onGenerateGenreQueue}
                  genreGenerating={genreGenerating}
                  onResetGenres={onResetGenres}
                  ytAutoQueue={ytAutoQueue}
                  ytAutoIndex={ytAutoIndex}
                  ytAutoOn={ytAutoOn}
                  ytAutoStatus={ytAutoStatus}
                  onStartYtAuto={onStartYtAuto}
                  onStopYtAuto={onStopYtAuto}
                  onAdvanceYtAuto={onAdvanceYtAuto}
                  onPlayYtAuto={playYtAutoIndex}
                  onMoveYtAuto={moveYtAutoTrack}
                  onRemoveYtAuto={removeYtAutoTrack}
                />
              )}
              {videoTab === 'HISTORIAL' && (
                <HistoryView history={history} onClear={clearHistory} />
              )}
              {videoTab === 'BIBLIOTECA' && (
                <div className="absolute inset-0 p-4">
                  <LibraryPanel accountId={djiaAccountKey} onLoadToDeck={loadYoutubeToDeck} />
                </div>
              )}
              {videoTab === 'MÚSICA LOCAL' && (
                <div className="absolute inset-0 p-4">
                  <MusicLibraryPanel
                    onLoadToDeck={(file, track, deck) => loadLocalFileToDeck(deck, file, track.bpm ?? undefined, track.beatGrid ?? undefined, track.hotCues ?? undefined, track.id)}
                  />
                </div>
              )}
              {/* vidrio real — brillo diagonal en movimiento + borde translúcido, mismo tratamiento que la pantalla de cristal aprobada */}
              <div
                className="pointer-events-none absolute -inset-y-1/2 -left-1/3 w-1/2 rotate-[14deg] animate-[dj-glass-sheen_7s_ease-in-out_infinite] motion-reduce:animate-none"
                style={{ background: 'linear-gradient(100deg, transparent, rgba(255,255,255,0.12) 45%, transparent 65%)' }}
                aria-hidden="true"
              />
              <div className="pointer-events-none absolute inset-0 rounded-xl shadow-[inset_0_1px_0_rgba(255,255,255,0.14),inset_0_0_40px_rgba(212,255,0,0.05)]" aria-hidden="true" />
            </div>
            <div className="mt-2.5 flex items-center gap-3.5">
              <span className="font-mono text-[11px] tabular-nums text-white/40">{fmtTime(ytPlayer.currentTime)}</span>
              <div
                className="relative h-[3px] flex-1 cursor-pointer touch-none rounded bg-white/10"
                onPointerDown={(e) => {
                  if (!ytVideoId) return
                  const seekAt = (clientX: number) => {
                    const rect = e.currentTarget.getBoundingClientRect()
                    const pct = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width))
                    ytPlayer.seekTo(pct * ytPlayer.duration)
                  }
                  seekAt(e.clientX)
                  e.currentTarget.setPointerCapture(e.pointerId)
                }}
                onPointerMove={(e) => {
                  if (!ytVideoId || e.buttons !== 1) return
                  const rect = e.currentTarget.getBoundingClientRect()
                  const pct = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width))
                  ytPlayer.seekTo(pct * ytPlayer.duration)
                }}
              >
                <div className="absolute inset-y-0 left-0 rounded" style={{ width: `${ytPlayer.duration > 0 ? (ytPlayer.currentTime / ytPlayer.duration) * 100 : 0}%`, background: DECK_A, boxShadow: `0 0 8px ${DECK_A}80` }} />
              </div>
              <span className="font-mono text-[11px] tabular-nums text-white/40">{fmtTime(ytPlayer.duration)}</span>
            </div>
            <div className="mt-2 flex items-center justify-center gap-4 text-white/40">
              <button type="button" onClick={() => setSourceShuffle((v) => !v)} aria-label="Aleatorio" aria-pressed={sourceShuffle} style={sourceShuffle ? { color: DECK_A } : undefined}><IconShuffle className="h-4 w-4" /></button>
              <button type="button" onClick={() => ytVideoId && ytPlayer.seekTo(Math.max(0, ytPlayer.currentTime - 10))} aria-label="Retroceder 10 segundos"><IconSkipBack className="h-4 w-4" /></button>
              <button
                type="button"
                onClick={() => { if (ytVideoId) { ytPlayer.isPlaying ? ytPlayer.pause() : ytPlayer.play() } }}
                aria-label={ytPlayer.isPlaying ? 'Pausar' : 'Reproducir'}
                className="flex h-[30px] w-[30px] items-center justify-center rounded-full border-[1.5px]"
                style={{ borderColor: DECK_A, color: DECK_A }}
              >
                {ytPlayer.isPlaying ? <IconPause className="h-3.5 w-3.5" /> : <IconPlay className="h-3.5 w-3.5" />}
              </button>
              <button type="button" onClick={() => ytVideoId && ytPlayer.seekTo(Math.min(ytPlayer.duration, ytPlayer.currentTime + 10))} aria-label="Avanzar 10 segundos"><IconSkipForward className="h-4 w-4" /></button>
              <button type="button" onClick={() => setSourceRepeat((v) => !v)} aria-label="Repetir" aria-pressed={sourceRepeat} style={sourceRepeat ? { color: DECK_A } : undefined}><IconRepeat className="h-4 w-4" /></button>
            </div>
            <div className="mt-2.5 flex gap-5 border-t border-white/[0.08] pt-2.5 text-[10.5px] font-bold tracking-[0.1em] text-white/30">
              {VIDEO_TABS.map((tab) => (
                <button
                  key={tab}
                  type="button"
                  onClick={() => setVideoTab(tab)}
                  className="relative pb-2"
                  style={videoTab === tab ? { color: DECK_A, boxShadow: `inset 0 -2px 0 0 ${DECK_A}` } : undefined}
                >
                  {tab}
                </button>
              ))}
            </div>
          </div>

          {/* ASISTENTE DJ IA — activación general + modos reales (energía, negocio, volumen automático) + emergencia. Ver efectos reales en el motor: ENERGY_MASTER_LEVEL/ENERGY_TRANSITION_SECONDS, smartVolume en useDeckEngine, safeSearch en app/api/search.ts. */}
          <div className="relative overflow-hidden rounded-2xl p-3.5" style={METAL_PANEL}>
            <MetalGrain />
            <div className="relative flex flex-wrap items-center gap-2.5">
              <button
                type="button"
                onClick={() => setDjiaActive((v) => !v)}
                className="rounded-full px-3.5 py-2 text-[11px] font-bold"
                style={djiaActive ? raisedActive(DECK_A) : RAISED_BTN}
              >
                {djiaActive ? '● DJ IA activado' : '○ Activar DJ IA'}
              </button>

              {djiaActive && (
                <>
                  <div className="flex items-center gap-1 rounded-full p-1" style={RAISED_BTN}>
                    {(['suave', 'normal', 'fiesta'] as EnergyMode[]).map((m) => (
                      <button
                        key={m}
                        type="button"
                        onClick={() => setEnergyMode(m)}
                        className="rounded-full px-2.5 py-1 text-[10px] font-bold"
                        style={energyMode === m ? { background: DECK_A, color: '#000' } : { color: 'rgba(255,255,255,0.5)' }}
                      >
                        {ENERGY_LABELS[m]}
                      </button>
                    ))}
                  </div>
                  <button
                    type="button"
                    onClick={() => setCleanMode((v) => !v)}
                    className="rounded-full px-2.5 py-1.5 text-[10px] font-bold"
                    style={cleanMode ? raisedActive(DECK_A) : { ...RAISED_BTN, color: 'rgba(255,255,255,0.6)' }}
                    title="Filtra la búsqueda de YouTube con safeSearch=strict de la propia API"
                  >
                    🏢 Modo negocio {cleanMode ? 'ON' : 'OFF'}
                  </button>
                  <button
                    type="button"
                    onClick={() => setSmartVolume((v) => !v)}
                    className="rounded-full px-2.5 py-1.5 text-[10px] font-bold"
                    style={smartVolume ? raisedActive(DECK_A) : { ...RAISED_BTN, color: 'rgba(255,255,255,0.6)' }}
                    title="Normaliza el TRIM de cada plato por el RMS real de la pista al cargarla"
                  >
                    🔊 Volumen automático {smartVolume ? 'ON' : 'OFF'}
                  </button>
                </>
              )}

              {silenceAlert && (
                <span
                  className="rounded-full px-3 py-1.5 text-[10.5px] font-bold text-amber-200"
                  style={{ background: 'rgba(245,158,11,0.15)', boxShadow: 'inset 0 0 0 1px rgba(245,158,11,0.4)', animation: 'dj-spectrum-pulse 1s ease-in-out infinite' }}
                  title="Un plato dice estar sonando pero el master no tiene audio real hace rato"
                >
                  ⚠️ Silencio detectado
                </span>
              )}

              <button
                type="button"
                onClick={() => setVideoTab('MEZCLA')}
                className="ml-auto rounded-full px-3.5 py-2 text-[11px] font-bold text-white/70"
                style={RAISED_BTN}
                title="Ir directo a la lista de canciones agregadas, sin tener que buscarla"
              >
                🎵 Lista{ytAutoQueue.length > 0 && ` (${ytAutoQueue.length})`}
              </button>
              <button
                type="button"
                onClick={() => setIsLive((v) => !v)}
                title="Solo marca la sesión como en vivo dentro de la app — no transmite audio ni video a ningún lado."
                className="rounded-full px-3.5 py-2 text-[11px] font-bold"
                style={isLive
                  ? { background: 'linear-gradient(180deg, rgba(239,68,68,0.35), rgba(239,68,68,0.12))', color: '#fecaca', boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.14), inset 0 -1px 0 rgba(0,0,0,0.4), 0 0 12px rgba(239,68,68,0.4)', animation: 'dj-spectrum-pulse 1.4s ease-in-out infinite' }
                  : { ...RAISED_BTN, color: 'rgba(255,255,255,0.6)' }}
              >
                🔴 {isLive ? 'EN VIVO (marca de estado, no transmite)' : 'Transmisión en vivo'}
              </button>
            </div>
          </div>

          {/* TRACK ROWS — reflejan el plato real, el espectro solo se mueve si hay pista y está sonando */}
          <div className="grid grid-cols-2 gap-3.5">
            <div className="relative flex flex-col gap-2 overflow-hidden rounded-2xl px-4 py-2.5" style={METAL_PANEL}>
              <MetalGrain />
              <div className="relative flex items-center justify-between">
                <div className="flex min-w-0 items-center gap-2.5">
                  <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-[1.5px] text-[10px] font-extrabold" style={{ borderColor: DECK_A, color: DECK_A }}>1</span>
                  <div className="min-w-0">
                    <div className="truncate text-[12.5px] font-bold leading-tight text-white">{deckAEngine.trackName ?? 'Sin pista'}</div>
                  </div>
                </div>
                <span className="shrink-0 font-mono text-[11px] text-white/30">{deckAEngine.bpm ? `${deckAEngine.bpm.toFixed(1)} BPM` : '-- BPM'}</span>
              </div>
              <RealWaveform engine={deckAEngine} color={DECK_A} detail="simple" />
              <div className="flex justify-between font-mono text-[9.5px] text-white/30">
                <span>{fmtTime(deckAEngine.currentTime)}</span>
                <span>{fmtTime(deckAEngine.currentTime)} / {fmtTime(deckAEngine.duration)}</span>
              </div>
            </div>
            <div className="relative flex flex-col gap-2 overflow-hidden rounded-2xl px-4 py-2.5" style={METAL_PANEL}>
              <MetalGrain />
              <div className="relative flex items-center justify-between">
                <div className="flex min-w-0 items-center gap-2.5">
                  <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-[1.5px] text-[10px] font-extrabold" style={{ borderColor: DECK_B, color: DECK_B }}>2</span>
                  <div className="min-w-0">
                    <div className="truncate text-[12.5px] font-bold leading-tight text-white">{deckBEngine.trackName ?? 'Sin pista'}</div>
                  </div>
                </div>
                <span className="shrink-0 font-mono text-[11px] text-white/30">{deckBEngine.bpm ? `${deckBEngine.bpm.toFixed(1)} BPM` : '-- BPM'}</span>
              </div>
              <RealWaveform engine={deckBEngine} color={DECK_B} detail="simple" />
              <div className="flex justify-between font-mono text-[9.5px] text-white/30">
                <span>{fmtTime(deckBEngine.currentTime)}</span>
                <span>{fmtTime(deckBEngine.currentTime)} / {fmtTime(deckBEngine.duration)}</span>
              </div>
            </div>
          </div>

          {/* DECKS + MIXER — única fila que necesita ancho fijo (mixer de 4 canales); scrollea aparte para no cortar el resto de la pantalla en ventanas angostas */}
          <div className="-mx-xl overflow-x-auto px-xl md:-mx-2xl md:px-2xl">
          <div className="grid min-w-[1020px] grid-cols-[minmax(260px,1fr)_minmax(360px,1.7fr)_minmax(260px,1fr)] items-start gap-4">
            <DeckUnit side="a" num={1} active="cue" engine={deckAEngine} syncTargetBpm={deckBEngine.bpm} syncTargetEngine={deckBEngine} jogSensitivity={jogSensA} onJogSensitivity={setJogSensA} ytOverride={ytOverride1} onLoadLocalFile={(file) => loadLocalFileToDeck(1, file)} libraryTrackId={libraryTrackId1} />

            <div className="relative flex flex-col gap-3.5 overflow-hidden rounded-2xl p-4" style={METAL_PANEL}>
              <MetalGrain />

              {/* MIC — trim por micrófono, mismo detalle que el rack Pioneer. Sin captura real de audio (no hay servicio externo que
                  inventar acá): el toggle es un estado real, la app no tiene entrada de micrófono en el motor de audio. Badge
                  visible (no solo este comentario) para que quien lo esté usando en vivo lo sepa, mismo criterio que CH3/CH4. */}
              <div className="relative flex flex-col items-center gap-1">
                <div className="flex items-center justify-center gap-6">
                  <div className="flex items-center gap-1.5">
                    <span className="text-[7px] font-bold tracking-[0.1em] text-white/30">MIC 1</span>
                    <Dial value={mic1Level} onChange={setMic1Level} color={DECK_A} active={mic1On} />
                    <button type="button" onClick={() => setMic1On((v) => !v)} className="rounded px-1.5 py-0.5 text-[6.5px] font-bold" style={mic1On ? raisedActive(DECK_A) : { ...RAISED_BTN, color: 'rgba(255,255,255,0.4)' }}>ON</button>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className="text-[7px] font-bold tracking-[0.1em] text-white/30">MIC 2</span>
                    <Dial value={mic2Level} onChange={setMic2Level} color={DECK_B} active={mic2On} />
                    <button type="button" onClick={() => setMic2On((v) => !v)} className="rounded px-1.5 py-0.5 text-[6.5px] font-bold" style={mic2On ? raisedActive(DECK_B) : { ...RAISED_BTN, color: 'rgba(255,255,255,0.4)' }}>ON</button>
                  </div>
                  <button type="button" onClick={() => setTalkoverOn((v) => !v)} className="rounded px-2 py-0.5 text-[7px] font-bold" style={talkoverOn ? raisedActive(DECK_A) : { ...RAISED_BTN, color: 'rgba(255,255,255,0.4)' }}>TALKOVER</button>
                </div>
                <span
                  title="La app no tiene entrada de micrófono real en el motor de audio — MIC 1/2 y TALKOVER guardan su estado pero no capturan ni mezclan ningún sonido."
                  className="rounded-full px-1.5 py-[1px] text-[6px] font-bold uppercase tracking-wide text-amber-300"
                  style={{ background: 'rgba(217,119,6,0.18)' }}
                >
                  Sin entrada real
                </span>
              </div>

              {/* SOUND COLOR FX — real: 4 perillas seleccionan+ajustan el mismo Sound Color FX del Plato 1 (reutiliza colorFxType/colorFxAmount que ya existían para los pads) */}
              <div className="relative flex items-center justify-center gap-3">
                {([['ECHO', 'dubecho'], ['NOISE', 'noise'], ['FILTER', 'filter'], ['CRUSH', 'crush']] as [string, ColorFxType][]).map(([label, type]) => (
                  <div key={label} className="flex flex-col items-center gap-1">
                    <Dial
                      color={DECK_A}
                      value={soundColorFx.type === type ? soundColorFx.amount : 0}
                      onChange={(v) => {
                        setSoundColorFx({ type, amount: v })
                        deckAEngine.setColorFxType(type)
                        deckAEngine.setColorFxAmount(v)
                        deckAEngine.setFxSendActive(v !== 0)
                      }}
                    />
                    <span className="rounded px-1 py-0.5 text-[6px] font-bold" style={soundColorFx.type === type && soundColorFx.amount !== 0 ? raisedActive(DECK_A) : RAISED_BTN}>{label}</span>
                  </div>
                ))}
                <div
                  className="ml-2 flex h-7 w-7 items-center justify-center rounded-full text-[6px] font-bold text-white/50"
                  style={{ background: `conic-gradient(${DECK_A}, #6ee7d8, ${DECK_B}, ${DECK_A})`, boxShadow: 'inset 0 0 0 5px #0a0b0c, 0 2px 4px rgba(0,0,0,0.5)' }}
                >
                  FX
                </div>
              </div>

              <div className="relative grid grid-cols-4 gap-3.5">
                <ChannelStrip
                  label="CH 1" color={DECK_A}
                  meterPct={Math.min(100, deckAEngine.level * 140)}
                  state={channelStateFromEngine(deckAEngine)}
                  onChange={(patch) => channelPatchToEngine(deckAEngine, patch)}
                  onCue={deckAEngine.toggleCue}
                  noRealEffect={!!ytVideoId1}
                />
                <ChannelStrip
                  label="CH 2" color={DECK_B}
                  meterPct={Math.min(100, deckBEngine.level * 140)}
                  state={channelStateFromEngine(deckBEngine)}
                  onChange={(patch) => channelPatchToEngine(deckBEngine, patch)}
                  onCue={deckBEngine.toggleCue}
                  noRealEffect={!!ytVideoId2}
                />
                <ChannelStrip
                  label="CH 3" color="#6ee7d8" meterPct={0} state={ch3}
                  onChange={(patch) => setCh3((prev) => ({ ...prev, ...patch }))}
                  onCue={() => setCh3((prev) => ({ ...prev, cueOn: !prev.cueOn }))}
                  noRealEffect noRealEffectBadge="Sin plato real" noRealEffectTitle="CH3 no tiene un plato de audio real detrás (la app solo mezcla 2 platos) — se mueve pero no cambia ningún sonido."
                />
                <ChannelStrip
                  label="CH 4" color="#f5a623" meterPct={0} state={ch4}
                  onChange={(patch) => setCh4((prev) => ({ ...prev, ...patch }))}
                  onCue={() => setCh4((prev) => ({ ...prev, cueOn: !prev.cueOn }))}
                  noRealEffect noRealEffectBadge="Sin plato real" noRealEffectTitle="CH4 no tiene un plato de audio real detrás (la app solo mezcla 2 platos) — se mueve pero no cambia ningún sonido."
                />
              </div>

              <div className="flex flex-col items-center gap-1.5">
                <div className="flex w-[260px] justify-between text-[10px] font-bold">
                  <span style={{ color: DECK_A }}>A</span>
                  <span style={{ color: DECK_B }}>B</span>
                </div>
                <div
                  className="relative h-[18px] w-[260px] touch-none rounded"
                  onPointerDown={onCrossfaderPointerDown}
                  onPointerMove={onCrossfaderPointerMove}
                  onPointerUp={onCrossfaderPointerUp}
                  onPointerCancel={onCrossfaderPointerUp}
                  style={{ background: 'linear-gradient(180deg,#020203,#0c0d0f)', boxShadow: 'inset 0 0 0 1px rgba(255,255,255,0.1), inset 0 2px 6px rgba(0,0,0,0.7)' }}
                >
                  <div
                    className="absolute top-1/2 h-6 w-7 -translate-x-1/2 -translate-y-1/2 cursor-ew-resize rounded"
                    style={{ left: `${((audio.crossfaderValue + 1) / 2) * 100}%`, background: 'linear-gradient(180deg, #52565f 0%, #2c2e33 45%, #0c0d0f 100%)', boxShadow: `0 3px 6px rgba(0,0,0,0.6), inset 0 1px 0 rgba(255,255,255,0.35), inset 0 0 0 1px ${DECK_A}66` }}
                  />
                </div>
                <div className="flex items-center gap-2 text-[9px] tracking-[0.06em] text-white/40">
                  <span>CURVE</span>
                  <button
                    type="button"
                    onClick={() => audio.setCrossfaderCurve(audio.crossfaderCurve === 'power' ? 'linear' : 'power')}
                    aria-label="Curva del crossfader"
                    aria-pressed={audio.crossfaderCurve === 'power'}
                    className="relative h-[15px] w-[30px] rounded-full"
                    style={{ background: 'linear-gradient(180deg,#050506,#0e0f11)', boxShadow: 'inset 0 1px 3px rgba(0,0,0,0.6)' }}
                  >
                    <div className="absolute top-[2px] h-[11px] w-[11px] rounded-full transition-all" style={{ left: audio.crossfaderCurve === 'power' ? '16px' : '2px', background: `radial-gradient(circle at 32% 26%, #eaff5c, ${DECK_A})`, boxShadow: `0 1px 2px rgba(0,0,0,0.5), 0 0 6px ${DECK_A}99` }} />
                  </button>
                  <span className="rounded-full px-2 py-0.5 font-bold" style={raisedActive(DECK_A)}>{audio.crossfaderCurve === 'power' ? 'SCRATCH' : 'LINEAR'}</span>
                </div>
                <div className="flex items-center gap-2 text-[7px] font-bold tracking-[0.08em] text-white/30">
                  <span title="Guarda a qué lado del crossfader se asignaría cada plato, pero el crossfader real siempre mezcla A/B directo — este selector todavía no cambia el mezclado real.">CROSSFADER ASSIGN</span>
                  {(['A', 'THRU', 'B'] as const).map((v) => (
                    <button key={v} type="button" onClick={() => setXfAssignA(v)} className="rounded px-1.5 py-0.5" style={xfAssignA === v ? raisedActive(DECK_A) : { ...RAISED_BTN, color: 'rgba(255,255,255,0.4)' }}>{v}</button>
                  ))}
                  {(['A', 'THRU', 'B'] as const).map((v) => (
                    <button key={`b-${v}`} type="button" onClick={() => setXfAssignB(v)} className="rounded px-1.5 py-0.5" style={xfAssignB === v ? raisedActive(DECK_B) : { ...RAISED_BTN, color: 'rgba(255,255,255,0.4)' }}>{v}</button>
                  ))}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="rounded-xl border border-white/[0.08] p-2.5">
                  <div className="mb-2 text-[9px] font-bold tracking-[0.12em] text-white/30">MASTER</div>
                  <div className="flex items-end gap-4">
                    <div className="flex flex-col items-center gap-1">
                      <Dial value={audio.masterLevel * 2 - 1} onChange={(v) => audio.setMasterLevel((v + 1) / 2)} />
                      <span className="text-[7px] tracking-[0.08em] text-white/30">LEVEL</span>
                    </div>
                    <div className="flex flex-col items-center gap-1">
                      <Dial value={audio.boothLevel * 2 - 1} onChange={(v) => audio.setBoothLevel((v + 1) / 2)} />
                      <span className="text-[7px] tracking-[0.08em] text-white/30">BOOTH</span>
                    </div>
                    <button type="button" onClick={() => audio.setLimiterOn(!audio.limiterOn)} className="rounded-full px-2 py-1 text-[8px] font-bold" style={audio.limiterOn ? raisedActive(DECK_A) : { ...RAISED_BTN, color: 'rgba(255,255,255,0.4)' }}>LIMITER</button>
                    <div className="ml-auto flex items-center gap-1.5">
                      <IconVolume className="h-3.5 w-3.5 text-white/40" />
                      <div className="flex flex-col items-center gap-0.5">
                        <Dial value={audio.cueMix * 2 - 1} onChange={(v) => audio.setCueMix(Math.max(0, (v + 1) / 2))} />
                        <span className="text-[6px] text-white/30">MIX</span>
                      </div>
                      <div className="flex flex-col items-center gap-0.5">
                        <Dial value={audio.headphoneVolume * 2 - 1} onChange={(v) => audio.setHeadphoneVolume(Math.max(0, (v + 1) / 2))} />
                        <span className="text-[6px] text-white/30">LEVEL</span>
                      </div>
                    </div>
                  </div>
                  <div className="mt-2 text-center text-[6.5px] font-bold tracking-[0.1em] text-white/25">HEADPHONES</div>
                </div>
                <div className="rounded-xl border border-white/[0.08] p-2.5">
                  <div className="mb-2 text-[9px] font-bold tracking-[0.12em] text-white/30">BEAT FX</div>
                  <div className="mb-2 flex flex-col gap-1">
                    {([['ECHO', 'dubecho'], ['REVERB', 'space'], ['FILTER ROLL', 'filter']] as [string, ColorFxType][]).map(([label, type]) => (
                      <button
                        key={label}
                        type="button"
                        onClick={() => { deckBEngine.setColorFxType(type); deckBEngine.setFxSendActive(true); if (deckBEngine.colorFxAmount === 0) deckBEngine.setColorFxAmount(0.6) }}
                        className="rounded-md py-1 text-center text-[9.5px] font-bold"
                        style={deckBEngine.fxSendActive && deckBEngine.colorFxType === type ? raisedActive(DECK_B) : { ...RAISED_BTN, color: 'rgba(255,255,255,0.45)' }}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                  <div className="mb-2 flex flex-col gap-1.5">
                    {/* Solo el primer slider (índice 0) es real — controla `colorFxAmount`
                        del efecto elegido arriba. Los otros dos (`beatFxExtra`) no tienen
                        parámetro real detrás en un rack de un solo Sound Color FX por plato
                        — quedan visualmente apagados y con tooltip para no simular un
                        control de 3 parámetros que no existe. */}
                    {[deckBEngine.colorFxAmount * 100, beatFxExtra[0], beatFxExtra[1]].map((pos, i) => (
                      <div
                        key={i}
                        title={i === 0 ? undefined : 'Este control no tiene un parámetro real detrás — el rack solo tiene un Sound Color FX activo por plato.'}
                        className="relative h-[3px] touch-none rounded bg-white/10"
                        onPointerDown={onBeatFxSliderDown(i, pos)}
                        onPointerMove={onBeatFxSliderMove}
                        onPointerUp={onBeatFxSliderUp}
                        onPointerCancel={onBeatFxSliderUp}
                        style={{ paddingBlock: 6, marginBlock: -6 }}
                      >
                        <span className="pointer-events-none absolute top-1/2 h-2.5 w-2.5 -translate-y-1/2 cursor-ew-resize rounded-full" style={{ left: `${pos}%`, background: i === 0 ? DECK_B : 'rgba(255,255,255,0.25)', boxShadow: i === 0 ? `0 0 5px ${DECK_B}99` : 'none' }} />
                      </div>
                    ))}
                  </div>
                  <button
                    type="button"
                    onClick={() => deckBEngine.setFxSendActive(false)}
                    className="block w-full rounded-md py-1 text-center text-[9px] font-bold"
                    style={!deckBEngine.fxSendActive ? raisedActive(DECK_B) : { ...RAISED_BTN, color: 'rgba(255,255,255,0.4)' }}
                  >
                    OFF
                  </button>
                </div>
              </div>
            </div>

            <DeckUnit side="b" num={2} active="sync" engine={deckBEngine} syncTargetBpm={deckAEngine.bpm} syncTargetEngine={deckAEngine} jogSensitivity={jogSensB} onJogSensitivity={setJogSensB} ytOverride={ytOverride2} onLoadLocalFile={(file) => loadLocalFileToDeck(2, file)} libraryTrackId={libraryTrackId2} />
          </div>

          {/* MINI PLAYER — refleja el plato que está sonando (A si está en play, si no B) */}
          <MiniPlayer deckA={deckAEngine} deckB={deckBEngine} onOpenSource={() => setVideoTab('SOURCE')} />
        </div>
      </div>
    </div>
  )
}
