import { useMemo, useState } from 'react'
import { IconHeart, IconMusic, IconPlus, IconSearch, IconTrash } from '../../../../shared/icons'
import {
  addLibraryTrack,
  addTrackToPlaylist,
  createPlaylist,
  deletePlaylist,
  listFavoriteTrackIdsFor,
  listLibraryTracksFor,
  listPlaylistsFor,
  removeLibraryTrack,
  removeTrackFromPlaylist,
  toggleFavoriteTrack,
  type LibraryTrack,
} from '../engine/libraryRepository'

/** 225 → "3:45". `null` cuando YouTube no informó duración (ej. algunos streams). */
function fmtDuration(sec: number | null): string {
  if (sec == null) return '—'
  const m = Math.floor(sec / 60)
  const s = Math.floor(sec % 60)
  return `${m}:${s.toString().padStart(2, '0')}`
}

/** timestamp → "hoy", "ayer", "hace 3 días", o la fecha corta si ya pasó más de una semana. */
function fmtAddedAt(ts: number): string {
  const diffMs = Date.now() - ts
  const days = Math.floor(diffMs / (1000 * 60 * 60 * 24))
  if (days <= 0) return 'hoy'
  if (days === 1) return 'ayer'
  if (days < 7) return `hace ${days} días`
  return new Date(ts).toLocaleDateString('es', { day: '2-digit', month: 'short' })
}

type Filter = 'all' | 'favorites' | string

export interface LibraryAddInput {
  id: string
  title: string
  artist?: string | null
  thumbnail?: string | null
  durationSec?: number | null
}

/** Se llama desde afuera (DjIaScreen) cada vez que se agrega un video a un plato o a la lista — así la Biblioteca crece sola con lo que ya se usa, sin un paso manual aparte. */
export function addToDjIaLibrary(accountId: string, input: LibraryAddInput): void {
  addLibraryTrack(accountId, input)
}

export function LibraryPanel({
  accountId,
  onLoadToDeck,
}: {
  accountId: string
  onLoadToDeck: (id: string, title: string, deck: 1 | 2) => void
}) {
  const [refreshKey, setRefreshKey] = useState(0)
  const bump = () => setRefreshKey((k) => k + 1)
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<Filter>('all')
  const [pickingDeckFor, setPickingDeckFor] = useState<string | null>(null)
  const [addingToPlaylistFor, setAddingToPlaylistFor] = useState<string | null>(null)
  const [newPlaylistName, setNewPlaylistName] = useState('')
  const [creatingPlaylist, setCreatingPlaylist] = useState(false)

  const allTracks = useMemo(() => listLibraryTracksFor(accountId), [accountId, refreshKey])
  const favoriteIds = useMemo(() => new Set(listFavoriteTrackIdsFor(accountId)), [accountId, refreshKey])
  const playlists = useMemo(() => listPlaylistsFor(accountId), [accountId, refreshKey])

  const visibleTracks = useMemo(() => {
    let list = allTracks
    if (filter === 'favorites') {
      list = list.filter((t: LibraryTrack) => favoriteIds.has(t.id))
    } else if (filter !== 'all') {
      const playlist = playlists.find((p) => p.id === filter)
      const idsInPlaylist = new Set(playlist?.trackIds ?? [])
      list = list.filter((t: LibraryTrack) => idsInPlaylist.has(t.id))
    }
    const q = query.trim().toLowerCase()
    if (q) list = list.filter((t: LibraryTrack) => t.title.toLowerCase().includes(q) || (t.artist ?? '').toLowerCase().includes(q))
    return list
  }, [allTracks, filter, favoriteIds, playlists, query])

  const handleCreatePlaylist = () => {
    const name = newPlaylistName.trim()
    if (!name) return
    createPlaylist(accountId, name)
    setNewPlaylistName('')
    setCreatingPlaylist(false)
    bump()
  }

  return (
    <div className="flex h-full flex-col gap-3 overflow-hidden text-white/90">
      {/* Búsqueda */}
      <div className="flex items-center gap-2 rounded-lg border border-white/10 bg-black/40 px-3 py-2">
        <IconSearch className="h-3.5 w-3.5 text-white/40" />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Buscar en tu biblioteca por título o artista…"
          className="w-full bg-transparent text-xs text-white outline-none placeholder:text-white/30"
        />
      </div>

      {/* Filtros: Todas / Favoritos / playlists */}
      <div className="flex flex-wrap items-center gap-1.5">
        <FilterChip active={filter === 'all'} onClick={() => setFilter('all')} label={`Todas (${allTracks.length})`} />
        <FilterChip active={filter === 'favorites'} onClick={() => setFilter('favorites')} label={`★ Favoritos (${favoriteIds.size})`} />
        {playlists.map((p) => (
          <FilterChip key={p.id} active={filter === p.id} onClick={() => setFilter(p.id)} label={`${p.name} (${p.trackIds.length})`} />
        ))}
        {!creatingPlaylist ? (
          <button
            type="button"
            onClick={() => setCreatingPlaylist(true)}
            className="flex items-center gap-1 rounded-full border border-dashed border-white/20 px-2.5 py-1 text-[10px] font-semibold text-white/50 hover:border-[#d4ff00]/50 hover:text-[#d4ff00]"
          >
            <IconPlus className="h-3 w-3" /> Nueva playlist
          </button>
        ) : (
          <form
            onSubmit={(e) => { e.preventDefault(); handleCreatePlaylist() }}
            className="flex items-center gap-1"
          >
            <input
              autoFocus
              value={newPlaylistName}
              onChange={(e) => setNewPlaylistName(e.target.value)}
              onBlur={() => { if (!newPlaylistName.trim()) setCreatingPlaylist(false) }}
              placeholder="Nombre…"
              className="w-28 rounded-full border border-white/20 bg-black/40 px-2.5 py-1 text-[10px] text-white outline-none"
            />
          </form>
        )}
      </div>

      {/* Lista */}
      <div className="flex-1 overflow-y-auto pr-1">
        {visibleTracks.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 py-10 text-center text-white/30">
            <IconMusic className="h-6 w-6" />
            <p className="text-xs">
              {allTracks.length === 0
                ? 'Todavía no agregaste ninguna canción. Se guardan solas cada vez que agregás algo de YouTube a un plato o a la lista.'
                : 'Nada coincide con este filtro.'}
            </p>
          </div>
        ) : (
          <ul className="flex flex-col gap-1.5">
            {visibleTracks.map((track) => (
              <li key={track.id} className="flex items-center gap-3 rounded-lg border border-white/[0.06] bg-white/[0.02] p-2 hover:border-white/15">
                {track.thumbnail ? (
                  <img src={track.thumbnail} alt="" className="h-10 w-16 shrink-0 rounded object-cover" />
                ) : (
                  <div className="flex h-10 w-16 shrink-0 items-center justify-center rounded bg-white/5">
                    <IconMusic className="h-4 w-4 text-white/20" />
                  </div>
                )}

                <div className="min-w-0 flex-1">
                  <p className="truncate text-xs font-semibold text-white">{track.title}</p>
                  <p className="truncate text-[10px] text-white/40">
                    {track.artist ?? 'YouTube'} · {fmtDuration(track.durationSec)} · agregada {fmtAddedAt(track.addedAt)}
                  </p>
                </div>

                <span className="hidden shrink-0 rounded-full bg-white/[0.06] px-2 py-0.5 text-[9px] font-bold uppercase tracking-wide text-white/40 sm:inline">
                  YouTube
                </span>

                <button
                  type="button"
                  onClick={() => { toggleFavoriteTrack(accountId, track.id); bump() }}
                  aria-label="Favorito"
                  className={`shrink-0 rounded-full p-1.5 ${favoriteIds.has(track.id) ? 'text-[#d4ff00]' : 'text-white/25 hover:text-white/60'}`}
                >
                  <IconHeart className="h-3.5 w-3.5" />
                </button>

                <div className="relative shrink-0">
                  <button
                    type="button"
                    onClick={() => setAddingToPlaylistFor((id) => (id === track.id ? null : track.id))}
                    className="rounded-full border border-white/15 px-2 py-1 text-[10px] font-semibold text-white/60 hover:border-white/30 hover:text-white"
                  >
                    + Playlist
                  </button>
                  {addingToPlaylistFor === track.id && (
                    <div className="absolute right-0 top-[calc(100%+4px)] z-10 w-40 rounded-lg border border-white/10 bg-[#141414] p-1.5 shadow-xl">
                      {playlists.length === 0 ? (
                        <p className="px-2 py-1 text-[10px] text-white/30">No hay playlists todavía</p>
                      ) : (
                        playlists.map((p) => (
                          <button
                            key={p.id}
                            type="button"
                            onClick={() => { addTrackToPlaylist(accountId, p.id, track.id); setAddingToPlaylistFor(null); bump() }}
                            className="block w-full truncate rounded px-2 py-1 text-left text-[10px] text-white/70 hover:bg-white/10 hover:text-white"
                          >
                            {p.name}
                          </button>
                        ))
                      )}
                    </div>
                  )}
                </div>

                <div className="relative shrink-0">
                  <button
                    type="button"
                    onClick={() => setPickingDeckFor((id) => (id === track.id ? null : track.id))}
                    className="rounded-full bg-[#d4ff00] px-3 py-1 text-[10px] font-bold text-black hover:opacity-90"
                  >
                    Cargar
                  </button>
                  {pickingDeckFor === track.id && (
                    <div className="absolute right-0 top-[calc(100%+4px)] z-10 flex gap-1 rounded-lg border border-white/10 bg-[#141414] p-1.5 shadow-xl">
                      <button
                        type="button"
                        onClick={() => { onLoadToDeck(track.id, track.title, 1); setPickingDeckFor(null) }}
                        className="rounded px-2.5 py-1 text-[10px] font-bold text-black"
                        style={{ background: '#d4ff00' }}
                      >
                        Plato 1
                      </button>
                      <button
                        type="button"
                        onClick={() => { onLoadToDeck(track.id, track.title, 2); setPickingDeckFor(null) }}
                        className="rounded px-2.5 py-1 text-[10px] font-bold text-black"
                        style={{ background: '#b26bff' }}
                      >
                        Plato 2
                      </button>
                    </div>
                  )}
                </div>

                {filter !== 'all' && filter !== 'favorites' && (
                  <button
                    type="button"
                    onClick={() => { removeTrackFromPlaylist(accountId, filter, track.id); bump() }}
                    className="shrink-0 rounded-full px-2 py-1 text-[9px] font-semibold text-white/30 hover:text-white/60"
                  >
                    Quitar de la playlist
                  </button>
                )}

                <button
                  type="button"
                  onClick={() => { removeLibraryTrack(accountId, track.id); bump() }}
                  aria-label="Quitar de la biblioteca"
                  className="shrink-0 rounded-full p-1.5 text-white/25 hover:text-red-400"
                >
                  <IconTrash className="h-3.5 w-3.5" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {playlists.length > 0 && filter !== 'all' && filter !== 'favorites' && (
        <button
          type="button"
          onClick={() => { deletePlaylist(accountId, filter); setFilter('all'); bump() }}
          className="self-start text-[10px] text-white/30 underline decoration-white/20 underline-offset-2 hover:text-red-400"
        >
          Eliminar esta playlist
        </button>
      )}
    </div>
  )
}

function FilterChip({ active, onClick, label }: { active: boolean; onClick: () => void; label: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-full px-2.5 py-1 text-[10px] font-semibold ${
        active ? 'bg-[#d4ff00] text-black' : 'border border-white/15 text-white/60 hover:border-white/30 hover:text-white'
      }`}
    >
      {label}
    </button>
  )
}

// Re-exporta el tipo por si algún consumidor externo lo necesita sin importar directo del repositorio.
export type { LibraryTrack }
