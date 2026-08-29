/**
 * MABRIONA MUSIC LEARNING ENGINE — perfil musical del usuario.
 * Persistencia real en localStorage, por cuenta (mismo criterio que
 * `favoritesRepository`/`continueListeningRepository`) — cada email
 * tiene su propio perfil, un invitado sin sesión usa `guest`, así
 * nunca se mezcla el gusto de una cuenta con el de otra (sección 22,
 * privacidad).
 *
 * Actualización incremental (sección 14): cada señal ajusta el perfil
 * al momento con una media móvil exponencial de dos velocidades — no
 * hace falta reconstruir nada desde el historial completo.
 */
import { getSession } from '../../auth/authRepository'
import { MUSIC_INTELLIGENCE_CONFIG as CFG } from './config'
import type { Affinity, UserMusicProfile } from './types'

const STORAGE_PREFIX = 'mabriona:music:profile:v1:'

export function currentUserKey(): string {
  return getSession()?.email ?? 'guest'
}

function emptyProfile(userKey: string): UserMusicProfile {
  return { userKey, updatedAt: Date.now(), totalSignals: 0, genres: {}, artists: {} }
}

export function readProfile(userKey: string = currentUserKey()): UserMusicProfile {
  if (typeof localStorage === 'undefined') return emptyProfile(userKey)
  const raw = localStorage.getItem(STORAGE_PREFIX + userKey)
  if (!raw) return emptyProfile(userKey)
  try {
    const parsed = JSON.parse(raw) as UserMusicProfile
    if (!parsed || typeof parsed !== 'object' || !parsed.genres || !parsed.artists) return emptyProfile(userKey)
    return parsed
  } catch {
    return emptyProfile(userKey)
  }
}

function writeProfile(profile: UserMusicProfile): void {
  if (typeof localStorage === 'undefined') return
  localStorage.setItem(STORAGE_PREFIX + profile.userKey, JSON.stringify(profile))
}

function updateAffinity(current: Affinity | undefined, weight: number): Affinity {
  const prev = current ?? { longTerm: 0, recent: 0 }
  return {
    longTerm: prev.longTerm * (1 - CFG.ALPHA_LONG_TERM) + weight * CFG.ALPHA_LONG_TERM,
    recent: prev.recent * (1 - CFG.ALPHA_RECENT) + weight * CFG.ALPHA_RECENT,
  }
}

/** Aplica una señal ya pesada al perfil del usuario actual. */
export function applySignal(input: { genre?: string; artistId?: string; weight: number }): UserMusicProfile {
  if (input.weight === 0 || (!input.genre && !input.artistId)) return readProfile()
  const profile = readProfile()
  if (input.genre) profile.genres[input.genre] = updateAffinity(profile.genres[input.genre], input.weight)
  if (input.artistId) profile.artists[input.artistId] = updateAffinity(profile.artists[input.artistId], input.weight)
  profile.totalSignals += 1
  profile.updatedAt = Date.now()
  writeProfile(profile)
  return profile
}

/**
 * Puntaje efectivo de una clave (género o artista) — sección 5, decay:
 * si pasó tiempo sin actividad nueva, la capa "reciente" se desvanece
 * hacia la de "largo plazo" en vez de quedar congelada. No muta lo
 * guardado — es una lectura, la escritura solo pasa por `applySignal`.
 */
export function effectiveAffinity(profile: UserMusicProfile, kind: 'genres' | 'artists', key: string): number {
  const a = profile[kind][key]
  if (!a) return 0
  const daysSinceUpdate = (Date.now() - profile.updatedAt) / 86_400_000
  const decay = Math.min(1, Math.max(0, daysSinceUpdate / CFG.RECENT_HALFLIFE_DAYS))
  const recentDecayed = a.recent + (a.longTerm - a.recent) * decay
  return a.longTerm * CFG.WEIGHT_LONG_TERM + recentDecayed * CFG.WEIGHT_RECENT
}

/** Solo para pruebas/depuración — borra el perfil de una cuenta (sección 22, "eliminación de perfil de preferencias"). */
export function clearProfile(userKey: string = currentUserKey()): void {
  if (typeof localStorage === 'undefined') return
  localStorage.removeItem(STORAGE_PREFIX + userKey)
}
