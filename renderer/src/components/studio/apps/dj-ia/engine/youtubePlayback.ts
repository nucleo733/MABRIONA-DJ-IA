/**
 * DJ IA — reproducción de YouTube (Plato 1 / Plato 2) — lógica pura,
 * sin DOM ni `window.YT`, para poder probarla con Vitest. La parte que
 * sí toca el DOM/la IFrame Player API real vive en `DjIaScreen.tsx`
 * (`useYoutubePlayer`/`useYoutubeDeckEngine`), que importa esto.
 *
 * Contexto de la fase "reproducción sin interrupciones publicitarias":
 * la IFrame Player API oficial de YouTube no expone ningún parámetro,
 * método o producto que permita a un embed de terceros suprimir los
 * anuncios que YouTube decida mostrar — eso lo controla YouTube/el
 * dueño del contenido del lado del servidor. No existe una forma
 * legítima de implementar "sin anuncios" hoy; `AD_FREE_PLAYBACK_STATUS`
 * documenta esto para que la UI y los tests nunca finjan lo contrario.
 */

/** Un id real de YouTube son 11 caracteres de [A-Za-z0-9_-] — mismo formato que devuelve la Data API. */
const YOUTUBE_VIDEO_ID_PATTERN = /^[A-Za-z0-9_-]{11}$/

export function isValidYoutubeVideoId(id: string | null | undefined): boolean {
  return typeof id === 'string' && YOUTUBE_VIDEO_ID_PATTERN.test(id)
}

export const YT_ERROR_LABELS: Record<number, string> = {
  2: 'ID de video inválido',
  5: 'error de reproductor HTML5',
  100: 'video no encontrado o privado',
  101: 'el dueño del video no permite insertarlo en otras webs',
  150: 'el dueño del video no permite insertarlo en otras webs',
}

/** Mensaje de error para el badge visible (JogWheel) — nunca deja un código crudo sin explicar. */
export function describeYoutubeError(code: number): string {
  return YT_ERROR_LABELS[code] ?? `código ${code}`
}

/** Volumen 0..1 (escala del resto de MABRIONA STUDIO) a 0..100 (escala real de `player.setVolume`), siempre dentro de rango. */
export function volumeToYoutubeScale(gain01: number): number {
  const clamped = Math.min(1, Math.max(0, gain01))
  return Math.round(clamped * 100)
}

/**
 * Estado real de "reproducción de YouTube sin interrupciones
 * publicitarias" dentro de MABRIONA — sección 4/18 de la fase: nunca
 * marcar esto como disponible si no lo es de verdad.
 */
export const AD_FREE_PLAYBACK_STATUS = {
  available: false,
  reason: 'no_official_mechanism' as const,
  explanation:
    'La IFrame Player API de YouTube no tiene ningún parámetro/método/producto que permita a un sitio de terceros suprimir los anuncios que YouTube decide mostrar — eso lo define YouTube/el dueño del contenido del lado del servidor, no el embed. Ni siquiera una cuenta con YouTube Premium lo garantiza: el estado de sesión del navegador del usuario en youtube.com no se traspasa a un iframe embebido en otro dominio.',
  whatWouldBeNeeded:
    'Un acuerdo/licencia directo con YouTube (o un producto oficial de YouTube para partners) que habilite reproducción sin anuncios para contenido embebido — no existe hoy para MABRIONA STUDIO.',
} as const
