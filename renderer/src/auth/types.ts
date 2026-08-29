/**
 * MABRIONA STUDIO — Modo CEO/Owner — roles.
 * `owner` es el único rol con control absoluto (edición en vivo de
 * toda la plataforma); el resto queda declarado para cuando existan
 * cuentas de equipo reales (Fase 2+), pero hoy ningún flujo los emite
 * todavía — no hay placeholders de permisos a medias, solo lo que de
 * verdad hace algo: `owner` vs todo lo demás ("modo usuario").
 */
export type Role = 'owner' | 'ceo' | 'admin' | 'editor' | 'artist' | 'user'

/**
 * Solicitud de registro como artista — datos reales que declara la
 * cuenta al pasar de `user` a `artist` (2026-08-22). `status` queda en
 * `'approved'` siempre por ahora (aprobación instantánea, para poder
 * probar el circuito completo); el campo existe para agregar después
 * una regla real de tiempo/proceso de verificación sin tocar el resto.
 */
export interface ArtistApplication {
  email: string
  legalName: string
  idNumber: string
  rightsAttested: true
  status: 'approved'
  createdAt: number
}
