/**
 * MABRIONA MUSIC LEARNING ENGINE — eventos musicales (sección 2).
 * Registro real en localStorage (buffer acotado por usuario, no una
 * base de eventos infinita — no hace falta más para alimentar el
 * perfil incremental ni para las métricas de evaluación de la sección
 * 18). No es un sistema de analytics genérico: solo los eventos con
 * señal real de gusto/rechazo (secciones 6 y 7) tocan el perfil; el
 * resto queda solo para trazabilidad/depuración (sección 26).
 */
import { MUSIC_INTELLIGENCE_CONFIG as CFG } from './config'
import { applySignal, currentUserKey } from './profile'
import type { MusicEvent, MusicEventSource, MusicEventType } from './types'

const LOG_PREFIX = 'mabriona:music:events:v1:'

function readLog(userKey: string): MusicEvent[] {
  if (typeof localStorage === 'undefined') return []
  const raw = localStorage.getItem(LOG_PREFIX + userKey)
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function appendLog(userKey: string, event: MusicEvent): void {
  if (typeof localStorage === 'undefined') return
  const all = readLog(userKey)
  all.push(event)
  localStorage.setItem(LOG_PREFIX + userKey, JSON.stringify(all.slice(-CFG.MAX_EVENT_LOG_ENTRIES)))
}

/** Señal graduada — un skip casi al final pesa mucho menos que uno inmediato (sección 7: el contexto importa, no todo skip es rechazo). */
export function weightFor(eventType: MusicEventType, progressRatio?: number): number {
  const weights: Partial<Record<MusicEventType, number>> = CFG.SIGNAL_WEIGHTS
  const base = weights[eventType] ?? 0
  if (eventType === 'skip' && typeof progressRatio === 'number') {
    return base * (1 - Math.min(1, Math.max(0, progressRatio)))
  }
  return base
}

function log(event: Omit<MusicEvent, 'timestamp'>): void {
  const userKey = currentUserKey()
  appendLog(userKey, { ...event, timestamp: Date.now() })
  const weight = weightFor(event.eventType, event.progressRatio)
  if (weight !== 0) applySignal({ genre: event.genre, artistId: event.artistId, weight })
}

interface TrackContext {
  itemId: string
  artistId?: string
  genre: string
  source: MusicEventSource
}

export function logPlayStarted(p: TrackContext): void {
  log({ eventType: 'play_started', ...p })
}
export function logPlayCompleted(p: TrackContext & { progressRatio: number }): void {
  log({ eventType: 'play_completed', ...p })
}
export function logSkip(p: TrackContext & { progressRatio: number }): void {
  log({ eventType: 'skip', ...p })
}
export function logLike(p: { itemId: string; artistId?: string; genre: string }): void {
  log({ eventType: 'like', source: 'music_catalog', ...p })
}
export function logUnlike(p: { itemId: string; artistId?: string; genre: string }): void {
  log({ eventType: 'unlike', source: 'music_catalog', ...p })
}
export function logFollowArtist(p: { artistId: string; genre?: string }): void {
  log({ eventType: 'follow_artist', source: 'music_catalog', ...p })
}
export function logUnfollowArtist(p: { artistId: string; genre?: string }): void {
  log({ eventType: 'unfollow_artist', source: 'music_catalog', ...p })
}
export function logDjSessionStarted(): void {
  log({ eventType: 'dj_session_started', source: 'dj_ia' })
}
export function logDjSessionEnded(): void {
  log({ eventType: 'dj_session_ended', source: 'dj_ia' })
}

export function listRecentEvents(userKey: string = currentUserKey()): MusicEvent[] {
  return readLog(userKey)
}

/** Métricas reales de evaluación (sección 18), calculadas sobre el registro de eventos de la cuenta actual. */
export function getEvaluationMetrics(userKey: string = currentUserKey()) {
  const events = readLog(userKey)
  const completed = events.filter((e) => e.eventType === 'play_completed').length
  const skipped = events.filter((e) => e.eventType === 'skip').length
  const likes = events.filter((e) => e.eventType === 'like').length
  const totalPlays = completed + skipped
  return {
    totalPlays,
    completionRate: totalPlays > 0 ? completed / totalPlays : 0,
    skipRate: totalPlays > 0 ? skipped / totalPlays : 0,
    likeRate: totalPlays > 0 ? likes / totalPlays : 0,
  }
}
