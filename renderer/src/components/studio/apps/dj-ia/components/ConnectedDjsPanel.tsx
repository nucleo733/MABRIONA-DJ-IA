import { useState } from 'react'
import { METAL_PANEL, MetalGrain, RAISED_BTN, raisedActive } from '../DjIaScreen'
import type { DjProfile } from '../ProfileGate'
import type { RemoteDj } from '../engine/djNetwork'

/**
 * "DJs conectados" — buscar otro DJ por username (sin importar la
 * red ni la distancia, es por internet vía Supabase Realtime, ver
 * `engine/djNetwork.ts`) y mandarle la canción que está sonando.
 */
export function ConnectedDjsPanel({
  profile, currentTrack, linking, linkError, onClaimUsername, onSearch, onSend, onClose,
}: {
  profile: DjProfile
  currentTrack: { id: string; title: string } | null
  linking: boolean
  linkError: string | null
  onClaimUsername: (username: string) => Promise<string | null>
  onSearch: (query: string) => Promise<RemoteDj[]>
  onSend: (dj: RemoteDj) => Promise<void>
  onClose: () => void
}) {
  const [usernameInput, setUsernameInput] = useState('')
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<RemoteDj[] | null>(null)
  const [searching, setSearching] = useState(false)
  const [sentTo, setSentTo] = useState<string | null>(null)

  const handleSearch = async () => {
    setSearching(true)
    setResults(await onSearch(query))
    setSearching(false)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.7)' }} onClick={onClose}>
      <div className="relative w-full max-w-md rounded-2xl p-5" style={METAL_PANEL} onClick={(e) => e.stopPropagation()}>
        <MetalGrain />
        <div className="relative flex items-center justify-between">
          <span className="text-[13px] font-bold text-white">🌐 DJs conectados</span>
          <button type="button" onClick={onClose} className="text-white/40 hover:text-white/70">✕</button>
        </div>

        {!profile.username ? (
          <div className="relative mt-4 flex flex-col gap-3">
            <p className="text-[10px] text-white/40">
              Elegí un nombre de usuario público para que otros DJs te puedan encontrar y mandarte canciones — sin importar la red ni la distancia.
            </p>
            <input
              type="text"
              value={usernameInput}
              onChange={(e) => setUsernameInput(e.target.value)}
              placeholder="tu_nombre_dj"
              className="w-full rounded-lg px-3 py-2 text-[12px] text-white placeholder:text-white/30 focus:outline-none"
              style={{ background: '#050608', boxShadow: 'inset 0 1px 3px rgba(0,0,0,0.7), inset 0 0 0 1px rgba(255,255,255,0.08)' }}
            />
            {linkError && <span className="text-[10px] font-semibold text-red-300">{linkError}</span>}
            <button
              type="button"
              onClick={() => void onClaimUsername(usernameInput)}
              disabled={linking || !usernameInput.trim()}
              className="rounded-lg py-2 text-[11px] font-bold text-black disabled:opacity-30"
              style={{ background: '#d4ff00' }}
            >
              {linking ? 'Conectando…' : 'Conectarme'}
            </button>
          </div>
        ) : (
          <div className="relative mt-4 flex flex-col gap-3">
            <span className="text-[10px] text-white/40">Tu username: <b className="text-white/70">@{profile.username}</b></span>
            <div className="flex gap-2">
              <input
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Buscar DJ por nombre…"
                className="flex-1 rounded-lg px-3 py-2 text-[12px] text-white placeholder:text-white/30 focus:outline-none"
                style={{ background: '#050608', boxShadow: 'inset 0 1px 3px rgba(0,0,0,0.7), inset 0 0 0 1px rgba(255,255,255,0.08)' }}
              />
              <button type="button" onClick={() => void handleSearch()} disabled={searching || !query.trim()} className="rounded-lg px-3 text-[11px] font-bold disabled:opacity-30" style={RAISED_BTN}>
                {searching ? '…' : 'Buscar'}
              </button>
            </div>
            {!currentTrack && <span className="text-[9.5px] text-amber-200/70">Cargá/reproducí una canción de YouTube primero para poder mandarla.</span>}
            <div className="flex flex-col gap-1.5">
              {results?.length === 0 && <span className="text-[10px] text-white/30">Nadie con ese nombre</span>}
              {results?.map((dj) => (
                <div key={dj.id} className="flex items-center justify-between gap-2 rounded-lg px-3 py-2" style={RAISED_BTN}>
                  <div className="flex items-center gap-2">
                    <span className="h-2 w-2 rounded-full" style={{ background: dj.online ? '#3ddc6f' : 'rgba(255,255,255,0.2)' }} />
                    <span className="text-[11px] font-semibold text-white/85">@{dj.username}</span>
                  </div>
                  <button
                    type="button"
                    disabled={!currentTrack}
                    onClick={async () => { if (!currentTrack) return; await onSend(dj); setSentTo(dj.id); setTimeout(() => setSentTo(null), 2000) }}
                    className="rounded-md px-2.5 py-1 text-[9.5px] font-bold disabled:opacity-30"
                    style={sentTo === dj.id ? raisedActive('#3ddc6f') : RAISED_BTN}
                  >
                    {sentTo === dj.id ? '✓ Enviada' : 'Enviar canción'}
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
