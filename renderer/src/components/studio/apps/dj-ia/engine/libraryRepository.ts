/**
 * Biblioteca de DJ IA — Persistencia real en localStorage, mismo
 * patrón que `musiccatalog/favoritesRepository.ts` (por accountId,
 * sin lista global sin dueño). Guarda solo referencia/metadata
 * (id de YouTube, título, artista, miniatura, duración, fecha) —
 * NUNCA el audio/video en sí. La reproducción sigue yendo siempre por
 * la integración oficial de YouTube ya existente en DjIaScreen.tsx.
 */

export interface LibraryTrack {
  id: string
  title: string
  artist: string | null
  thumbnail: string | null
  source: 'youtube'
  durationSec: number | null
  addedAt: number
}

export interface LibraryPlaylist {
  id: string
  name: string
  trackIds: string[]
  createdAt: number
}

interface AddLibraryTrackInput {
  id: string
  title: string
  artist?: string | null
  thumbnail?: string | null
  durationSec?: number | null
}

const TRACKS_KEY = 'dj-ia:library:tracks:v1'
const FAVORITES_KEY = 'dj-ia:library:favorites:v1'
const PLAYLISTS_KEY = 'dj-ia:library:playlists:v1'

interface TracksState {
  byAccount: Record<string, LibraryTrack[]>
}
interface FavoritesState {
  byAccount: Record<string, string[]>
}
interface PlaylistsState {
  byAccount: Record<string, LibraryPlaylist[]>
}

function readJson<T>(key: string, fallback: T): T {
  if (typeof localStorage === 'undefined') return fallback
  const raw = localStorage.getItem(key)
  if (!raw) return fallback
  try {
    return JSON.parse(raw) as T
  } catch {
    return fallback
  }
}

function writeJson<T>(key: string, value: T): void {
  if (typeof localStorage === 'undefined') return
  localStorage.setItem(key, JSON.stringify(value))
}

// --- Pistas ---

function readTracksState(): TracksState {
  const state = readJson<TracksState>(TRACKS_KEY, { byAccount: {} })
  return state?.byAccount ? state : { byAccount: {} }
}

function writeTracksState(state: TracksState): void {
  writeJson(TRACKS_KEY, state)
}

/** Más reciente primero (por `addedAt`). */
export function listLibraryTracksFor(accountId: string): LibraryTrack[] {
  const tracks = readTracksState().byAccount[accountId] ?? []
  return [...tracks].sort((a, b) => b.addedAt - a.addedAt)
}

export function getLibraryTrack(accountId: string, trackId: string): LibraryTrack | null {
  return (readTracksState().byAccount[accountId] ?? []).find((t) => t.id === trackId) ?? null
}

/**
 * Agrega (o, si ya estaba, la trae de nuevo arriba actualizando su
 * fecha — mismo criterio intuitivo que "recientemente agregadas": si
 * la volviste a usar, cuenta como reciente otra vez).
 */
export function addLibraryTrack(accountId: string, input: AddLibraryTrackInput): void {
  const state = readTracksState()
  const current = state.byAccount[accountId] ?? []
  const existing = current.find((t) => t.id === input.id)
  const track: LibraryTrack = {
    id: input.id,
    title: input.title,
    artist: input.artist ?? existing?.artist ?? null,
    thumbnail: input.thumbnail ?? existing?.thumbnail ?? null,
    source: 'youtube',
    durationSec: input.durationSec ?? existing?.durationSec ?? null,
    addedAt: Date.now(),
  }
  state.byAccount[accountId] = [track, ...current.filter((t) => t.id !== input.id)]
  writeTracksState(state)
}

export function removeLibraryTrack(accountId: string, trackId: string): void {
  const state = readTracksState()
  state.byAccount[accountId] = (state.byAccount[accountId] ?? []).filter((t) => t.id !== trackId)
  writeTracksState(state)
  // Deja de estar en favoritos y se saca de cualquier playlist — no debe quedar un id huérfano.
  toggleFavoriteInternal(accountId, trackId, false)
  const playlistsState = readPlaylistsState()
  const playlists = playlistsState.byAccount[accountId] ?? []
  playlistsState.byAccount[accountId] = playlists.map((p) => ({ ...p, trackIds: p.trackIds.filter((id) => id !== trackId) }))
  writePlaylistsState(playlistsState)
}

// --- Favoritos ---

function readFavoritesState(): FavoritesState {
  const state = readJson<FavoritesState>(FAVORITES_KEY, { byAccount: {} })
  return state?.byAccount ? state : { byAccount: {} }
}

function writeFavoritesState(state: FavoritesState): void {
  writeJson(FAVORITES_KEY, state)
}

export function listFavoriteTrackIdsFor(accountId: string): string[] {
  return readFavoritesState().byAccount[accountId] ?? []
}

export function isFavoriteTrack(accountId: string, trackId: string): boolean {
  return listFavoriteTrackIdsFor(accountId).includes(trackId)
}

function toggleFavoriteInternal(accountId: string, trackId: string, forceValue?: boolean): boolean {
  const state = readFavoritesState()
  const current = state.byAccount[accountId] ?? []
  const isFav = current.includes(trackId)
  const nextValue = forceValue ?? !isFav
  state.byAccount[accountId] = nextValue ? Array.from(new Set([trackId, ...current])) : current.filter((id) => id !== trackId)
  writeFavoritesState(state)
  return nextValue
}

/** Devuelve el nuevo estado (true = ahora es favorito). */
export function toggleFavoriteTrack(accountId: string, trackId: string): boolean {
  return toggleFavoriteInternal(accountId, trackId)
}

// --- Playlists ---

function readPlaylistsState(): PlaylistsState {
  const state = readJson<PlaylistsState>(PLAYLISTS_KEY, { byAccount: {} })
  return state?.byAccount ? state : { byAccount: {} }
}

function writePlaylistsState(state: PlaylistsState): void {
  writeJson(PLAYLISTS_KEY, state)
}

/** Más nueva primero. */
export function listPlaylistsFor(accountId: string): LibraryPlaylist[] {
  const playlists = readPlaylistsState().byAccount[accountId] ?? []
  return [...playlists].sort((a, b) => b.createdAt - a.createdAt)
}

export function createPlaylist(accountId: string, name: string): LibraryPlaylist {
  const state = readPlaylistsState()
  const playlist: LibraryPlaylist = {
    id: `pl_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
    name: name.trim() || 'Playlist sin nombre',
    trackIds: [],
    createdAt: Date.now(),
  }
  state.byAccount[accountId] = [playlist, ...(state.byAccount[accountId] ?? [])]
  writePlaylistsState(state)
  return playlist
}

export function renamePlaylist(accountId: string, playlistId: string, name: string): void {
  const state = readPlaylistsState()
  state.byAccount[accountId] = (state.byAccount[accountId] ?? []).map((p) =>
    p.id === playlistId ? { ...p, name: name.trim() || p.name } : p,
  )
  writePlaylistsState(state)
}

export function deletePlaylist(accountId: string, playlistId: string): void {
  const state = readPlaylistsState()
  state.byAccount[accountId] = (state.byAccount[accountId] ?? []).filter((p) => p.id !== playlistId)
  writePlaylistsState(state)
}

export function addTrackToPlaylist(accountId: string, playlistId: string, trackId: string): void {
  const state = readPlaylistsState()
  state.byAccount[accountId] = (state.byAccount[accountId] ?? []).map((p) =>
    p.id === playlistId && !p.trackIds.includes(trackId) ? { ...p, trackIds: [...p.trackIds, trackId] } : p,
  )
  writePlaylistsState(state)
}

export function removeTrackFromPlaylist(accountId: string, playlistId: string, trackId: string): void {
  const state = readPlaylistsState()
  state.byAccount[accountId] = (state.byAccount[accountId] ?? []).map((p) =>
    p.id === playlistId ? { ...p, trackIds: p.trackIds.filter((id) => id !== trackId) } : p,
  )
  writePlaylistsState(state)
}
