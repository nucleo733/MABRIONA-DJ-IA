/**
 * MABRIONA MUSIC LEARNING ENGINE — punto de entrada público.
 * Ver `profile.ts` (perfil por cuenta), `eventLog.ts` (eventos +
 * señales) y `recommend.ts` (ranking) para el detalle de cada pieza.
 */
export type { MusicEvent, MusicEventType, MusicEventSource, Affinity, UserMusicProfile } from './types'
export { currentUserKey, readProfile, effectiveAffinity, clearProfile } from './profile'
export {
  logPlayStarted,
  logPlayCompleted,
  logSkip,
  logLike,
  logUnlike,
  logFollowArtist,
  logUnfollowArtist,
  logDjSessionStarted,
  logDjSessionEnded,
  listRecentEvents,
  getEvaluationMetrics,
} from './eventLog'
export { getRecommendedItemIds, getGenreWeights, weightedShuffle } from './recommend'
export type { RankableItem, RankedResult } from './recommend'
