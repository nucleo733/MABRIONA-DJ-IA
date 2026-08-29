/**
 * MABRIONA MUSIC LEARNING ENGINE — tipos.
 * Módulo agnóstico de UI: no importa tipos de `musiccatalog/` ni de
 * `dj-ia/` a propósito — recibe formas mínimas (`RankableItem`) desde
 * quien lo llama, así lo puede usar tanto MUSIC como DJ IA sin acoplar
 * un motor de aprendizaje a la forma de datos de una sola pantalla.
 */
export type MusicEventType =
  | 'play_started'
  | 'play_completed'
  | 'skip'
  | 'like'
  | 'unlike'
  | 'follow_artist'
  | 'unfollow_artist'
  | 'dj_session_started'
  | 'dj_session_ended'

export type MusicEventSource = 'music_catalog' | 'dj_ia'

export interface MusicEvent {
  eventType: MusicEventType
  timestamp: number
  itemId?: string
  artistId?: string
  genre?: string
  source: MusicEventSource
  /** 0..1 — cuánto de la pista se escuchó antes del cambio (play_completed/skip). */
  progressRatio?: number
}

/** Afinidad de dos capas — memoria de largo plazo vs. lo que está sonando últimamente (sección 4). */
export interface Affinity {
  longTerm: number
  recent: number
}

export interface UserMusicProfile {
  userKey: string
  updatedAt: number
  totalSignals: number
  genres: Record<string, Affinity>
  artists: Record<string, Affinity>
}
