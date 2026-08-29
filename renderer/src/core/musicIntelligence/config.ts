/**
 * MABRIONA MUSIC LEARNING ENGINE — constantes de ajuste.
 * Un solo lugar para pesos/umbrales/decay (nunca hardcodeados en el
 * motor de perfil, el rankeador o los llamadores) para poder afinarlos
 * sin tocar la lógica.
 */
export const MUSIC_INTELLIGENCE_CONFIG = {
  /** EMA "reciente" — reacciona rápido a lo que el usuario escucha ahora. */
  ALPHA_RECENT: 0.35,
  /** EMA "largo plazo" — se mueve despacio, representa el gusto estable. */
  ALPHA_LONG_TERM: 0.06,
  /** Cómo se combinan ambas capas al puntuar (sección 4 de la especificación). */
  WEIGHT_LONG_TERM: 0.6,
  WEIGHT_RECENT: 0.4,
  /** Si pasan ~esta cantidad de días sin actividad, "reciente" se desvanece hacia "largo plazo" (sección 5, decay). */
  RECENT_HALFLIFE_DAYS: 14,
  /** Antes de esta cantidad de señales, no hay suficiente información — se usa el fallback (cold start, sección 20). */
  MIN_SIGNALS_FOR_PERSONALIZATION: 5,
  /** Tamaño de la fila "Recomendado para ti". */
  RECOMMENDED_SLOTS: 14,
  /** De esos, cuántos se reservan para descubrimiento (sección 10). */
  DISCOVERY_SLOTS: 2,
  /** Diversidad: tope de items del mismo artista en la selección principal (sección 19). */
  MAX_PER_ARTIST: 2,
  /** A partir de este % de la canción escuchada, un cambio de pista cuenta como "completada" y no como skip. */
  COMPLETION_RATIO_THRESHOLD: 0.85,
  /** Pesos por tipo de señal (secciones 6 y 7) — no todas las señales valen igual. */
  SIGNAL_WEIGHTS: {
    play_completed: 1,
    skip: -0.6,
    like: 2,
    unlike: -1.2,
    follow_artist: 2.5,
    unfollow_artist: -1.5,
  } as const,
  /** Registro de eventos — buffer acotado por usuario (no crece sin límite). */
  MAX_EVENT_LOG_ENTRIES: 300,
} as const
