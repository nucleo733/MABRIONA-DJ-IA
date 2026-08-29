/**
 * MABRIONA MUSIC LEARNING ENGINE — motor de ranking.
 * Candidate generation → ranking → diversidad → descubrimiento
 * (sección 15), sobre datos reales del perfil — sin metadatos que no
 * existen en el catálogo (no hay BPM/energía/mood en `MusicCatalogItem`
 * hoy, así que el ranking usa lo que sí es real: género y artista).
 */
import { MUSIC_INTELLIGENCE_CONFIG as CFG } from './config'
import { effectiveAffinity } from './profile'
import type { UserMusicProfile } from './types'

export interface RankableItem {
  id: string
  genre: string
  artistId?: string
}

export interface RankedResult {
  ids: string[]
  /** false = todavía no hay suficiente señal — se devolvió el fallback tal cual (cold start, sección 20). */
  personalized: boolean
}

function shuffle<T>(items: T[]): T[] {
  const copy = [...items]
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[copy[i], copy[j]] = [copy[j], copy[i]]
  }
  return copy
}

function scoreOf(profile: UserMusicProfile, item: RankableItem): number {
  const genreScore = effectiveAffinity(profile, 'genres', item.genre)
  const artistScore = item.artistId ? effectiveAffinity(profile, 'artists', item.artistId) : 0
  return genreScore + artistScore
}

/**
 * Fila "Recomendado para ti" (secciones 9/10/19/20): mezcla familiaridad
 * (lo que el ranking indica que probablemente le guste) con un cupo de
 * descubrimiento, y nunca repite un mismo artista más que el tope de
 * diversidad. Con perfil insuficiente devuelve el fallback intacto —
 * no inventa personalización donde no la hay.
 */
export function getRecommendedItemIds(
  candidates: RankableItem[],
  profile: UserMusicProfile,
  fallbackIds: string[],
): RankedResult {
  if (profile.totalSignals < CFG.MIN_SIGNALS_FOR_PERSONALIZATION || candidates.length === 0) {
    return { ids: fallbackIds, personalized: false }
  }

  const scored = candidates
    .map((item) => ({ item, score: scoreOf(profile, item) }))
    .sort((a, b) => b.score - a.score)

  const familiarTarget = Math.max(0, CFG.RECOMMENDED_SLOTS - CFG.DISCOVERY_SLOTS)
  const selected: string[] = []
  const perArtist = new Map<string, number>()
  for (const { item, score } of scored) {
    // Solo lo que realmente puntúa a favor cuenta como "familiar" — si no alcanza para llenar
    // el cupo, se deja para el paso de descubrimiento en vez de rellenar con algo que no le gustó.
    if (score <= 0) break
    if (selected.length >= familiarTarget) break
    const artistKey = item.artistId ?? item.id
    const count = perArtist.get(artistKey) ?? 0
    if (count >= CFG.MAX_PER_ARTIST) continue
    selected.push(item.id)
    perArtist.set(artistKey, count + 1)
  }

  const selectedSet = new Set(selected)
  const remainingRaw = candidates.filter((c) => !selectedSet.has(c.id))
  // Descubrimiento: géneros que el usuario no rechazó activamente, no cualquier cosa al azar.
  const unexplored = remainingRaw.filter((c) => effectiveAffinity(profile, 'genres', c.genre) > -0.1)
  const discoveryPool = shuffle(unexplored.length > 0 ? unexplored : remainingRaw)
  for (const item of discoveryPool) {
    if (selected.length >= CFG.RECOMMENDED_SLOTS) break
    const artistKey = item.artistId ?? item.id
    const count = perArtist.get(artistKey) ?? 0
    if (count >= CFG.MAX_PER_ARTIST) continue
    selected.push(item.id)
    perArtist.set(artistKey, count + 1)
  }

  return { ids: selected, personalized: true }
}

/**
 * Pesos normalizados 0..1 por género para que DJ IA priorice el orden
 * de su cola (sección 12/13) — nunca toca el motor de audio/beatmatch,
 * solo la prioridad con la que aparece cada género. Usuario sin señal:
 * todos los géneros parten parejo, igual que el shuffle simple de hoy.
 */
export function getGenreWeights(profile: UserMusicProfile, genreNames: string[]): Record<string, number> {
  const raw = genreNames.map((g) => Math.max(0, effectiveAffinity(profile, 'genres', g)))
  const hasSignal = raw.some((v) => v > 0)
  const max = Math.max(1e-6, ...raw)
  const weights: Record<string, number> = {}
  genreNames.forEach((g, i) => {
    weights[g] = hasSignal ? raw[i] / max || 0.35 : 1
  })
  return weights
}

/**
 * Baraja ponderada — clave = -ln(rand)/peso, orden ascendente. A
 * diferencia de un simple sort por afinidad, sigue siendo aleatoria
 * (no clava siempre el mismo orden ni encierra al usuario en 3
 * canciones) pero un peso mayor tiene más chance de salir temprano.
 */
export function weightedShuffle<T>(items: T[], weightOf: (item: T) => number): T[] {
  return items
    .map((item) => ({ item, key: -Math.log(Math.random() + 1e-9) / Math.max(1e-6, weightOf(item)) }))
    .sort((a, b) => a.key - b.key)
    .map((entry) => entry.item)
}
