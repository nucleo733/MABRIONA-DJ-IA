import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from '../../../../../lib/supabase'
import type { DjProfile } from '../ProfileGate'

export interface IncomingTrack {
  fromUsername: string
  id: string
  title: string
  at: number
}

export interface RemoteDj {
  id: string
  username: string
  display_name: string
  online: boolean
}

const PRESENCE_CHANNEL = 'matoko:presence'

/**
 * Conexión real a Supabase — mismo proyecto y mismo patrón de canales
 * broadcast/presence ya usado en CIELO (`callSignalingService.ts`/
 * `presenceService.ts` de MABRIONA-STUDIO) — no un mock ni una cola
 * local. Se activa recién cuando el perfil local tiene `username`
 * (paso opcional, "DJs conectados"); antes de eso no abre ninguna
 * conexión.
 */
export function useDjNetwork(profile: DjProfile | null) {
  const [linking, setLinking] = useState(false)
  const [linkError, setLinkError] = useState<string | null>(null)
  const [incoming, setIncoming] = useState<IncomingTrack | null>(null)
  const [onlineIds, setOnlineIds] = useState<Set<string>>(new Set())
  const presenceChRef = useRef<ReturnType<typeof supabase.channel> | null>(null)
  const ownChRef = useRef<ReturnType<typeof supabase.channel> | null>(null)

  // Se suscribe a: (a) el canal privado propio (`matoko:<user_id>`,
  // para recibir canciones que le mandan), (b) el canal de presencia
  // compartido (para que las búsquedas de otros puedan ver "en
  // línea"). Solo si ya hay una sesión real de Supabase para este
  // perfil (username ya elegido).
  useEffect(() => {
    if (!profile?.username) return
    let cancelled = false
    ;(async () => {
      let { data } = await supabase.auth.getSession()
      // La sesión persistida por `supabase-js` (localStorage) debería
      // alcanzar en el arranque normal — este es un respaldo real por
      // si se perdió (perfil de datos limpiado a mano, etc.), usando
      // las credenciales sintéticas guardadas al elegir el username.
      if (!data.session && profile.supabaseEmail && profile.supabasePassword) {
        const res = await supabase.auth.signInWithPassword({ email: profile.supabaseEmail, password: profile.supabasePassword })
        data = { session: res.data.session }
      }
      const userId = data.session?.user.id
      if (!userId || cancelled) return

      const ownCh = supabase.channel(`matoko:${userId}`)
      ownCh.on('broadcast', { event: 'track' }, ({ payload }: { payload: { fromUsername: string; id: string; title: string } }) => {
        setIncoming({ fromUsername: payload.fromUsername, id: payload.id, title: payload.title, at: Date.now() })
      })
      ownCh.subscribe()
      ownChRef.current = ownCh

      const presenceCh = supabase.channel(PRESENCE_CHANNEL, { config: { presence: { key: userId } } })
      presenceCh.on('presence', { event: 'sync' }, () => {
        setOnlineIds(new Set(Object.keys(presenceCh.presenceState())))
      })
      presenceCh.subscribe((status: string) => {
        if (status === 'SUBSCRIBED') void presenceCh.track({ online_at: new Date().toISOString() })
      })
      presenceChRef.current = presenceCh
    })()
    return () => {
      cancelled = true
      ownChRef.current?.unsubscribe()
      presenceChRef.current?.unsubscribe()
    }
  }, [profile?.username, profile?.supabaseEmail, profile?.supabasePassword])

  /**
   * Registra el username elegido — el login anónimo real de Supabase
   * está desactivado en este proyecto (confirmado: HTTP 422
   * "anonymous_provider_disabled"), así que se crea una cuenta real
   * con un email sintético (nunca mostrado, no es una casilla de
   * verdad) + contraseña random — mismo criterio que un login
   * anónimo, sin depender de una config que no se puede cambiar desde
   * acá. El trigger `handle_new_user` de Supabase crea la fila en
   * `profiles` automáticamente con este username/nombre.
   */
  const claimUsername = useCallback(async (username: string, displayName: string) => {
    setLinking(true)
    setLinkError(null)
    try {
      const clean = username.trim().toLowerCase()
      if (!/^[a-z0-9._]{3,30}$/.test(clean)) throw new Error('Usá solo letras, números, punto o guión bajo (3 a 30 caracteres)')
      const { data: existing } = await supabase.from('profiles').select('id').eq('username', clean).maybeSingle()
      if (existing) throw new Error('Ese nombre ya lo tiene otro DJ — probá otro')
      const email = `matoko-dj-${clean}-${Date.now().toString(36)}@matoko.local`
      const password = Array.from(crypto.getRandomValues(new Uint8Array(18))).map((b) => b.toString(36)).join('').slice(0, 24)
      const { error } = await supabase.auth.signUp({ email, password, options: { data: { username: clean, display_name: displayName } } })
      if (error) throw error
      return { username: clean, email, password }
    } catch (err) {
      setLinkError(err instanceof Error ? err.message : String(err))
      return null
    } finally {
      setLinking(false)
    }
  }, [])

  const searchDjs = useCallback(async (query: string): Promise<RemoteDj[]> => {
    const clean = query.trim().toLowerCase()
    if (!clean) return []
    const { data, error } = await supabase.from('profiles').select('id, username, display_name').ilike('username', `%${clean}%`).limit(10)
    if (error || !data) return []
    return data.map((d: { id: string; username: string; display_name: string }) => ({ id: d.id, username: d.username, display_name: d.display_name, online: onlineIds.has(d.id) }))
  }, [onlineIds])

  const sendTrack = useCallback(async (toUserId: string, fromUsername: string, track: { id: string; title: string }) => {
    const ch = supabase.channel(`matoko:${toUserId}`)
    await ch.subscribe()
    await ch.send({ type: 'broadcast', event: 'track', payload: { fromUsername, id: track.id, title: track.title } })
    await ch.unsubscribe()
  }, [])

  return { linking, linkError, claimUsername, searchDjs, sendTrack, incoming, clearIncoming: () => setIncoming(null) }
}
