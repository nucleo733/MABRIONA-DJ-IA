import { useCallback, useRef, useState } from 'react'
import { METAL_PANEL, MetalGrain, RAISED_BTN, raisedActive } from './DjIaScreen'

export interface DjProfile {
  id: string
  name: string
  pin: string // 4 dígitos, como string para no perder ceros a la izquierda
  photo: string | null // data URL (JPEG, ya redimensionada)
}

const PROFILES_KEY = 'dj-ia:profiles'
const GLOW = ['#ff3d81', '#ff9500', '#22d3ee', '#d4ff00', '#b26bff']

function readProfiles(): DjProfile[] {
  try {
    const raw = localStorage.getItem(PROFILES_KEY)
    return raw ? (JSON.parse(raw) as DjProfile[]) : []
  } catch {
    return []
  }
}

function writeProfiles(profiles: DjProfile[]) {
  try { localStorage.setItem(PROFILES_KEY, JSON.stringify(profiles)) } catch { /* localStorage lleno o bloqueado, no es crítico */ }
}

/**
 * Achica la foto antes de guardarla (JPEG, máx 240x240) — sin esto,
 * una foto de cámara moderna (varios MB) satura `localStorage` rápido
 * si hay varios perfiles. Se hace con un `<canvas>` real, no un
 * placeholder — recorta al centro para que quede cuadrada.
 */
function resizePhoto(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    const url = URL.createObjectURL(file)
    img.onload = () => {
      const size = 240
      const canvas = document.createElement('canvas')
      canvas.width = size
      canvas.height = size
      const ctx2d = canvas.getContext('2d')
      if (!ctx2d) { URL.revokeObjectURL(url); reject(new Error('sin contexto 2d')); return }
      const srcSize = Math.min(img.width, img.height)
      const sx = (img.width - srcSize) / 2
      const sy = (img.height - srcSize) / 2
      ctx2d.drawImage(img, sx, sy, srcSize, srcSize, 0, 0, size, size)
      URL.revokeObjectURL(url)
      resolve(canvas.toDataURL('image/jpeg', 0.85))
    }
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('no se pudo leer la imagen')) }
    img.src = url
  })
}

function PinPad({ value, onDigit, onBackspace }: { value: string; onDigit: (d: string) => void; onBackspace: () => void }) {
  return (
    <div className="flex flex-col items-center gap-4">
      <div className="flex gap-3">
        {[0, 1, 2, 3].map((i) => (
          <div
            key={i}
            className="flex h-10 w-10 items-center justify-center rounded-lg text-lg font-bold text-white"
            style={i < value.length ? raisedActive('#d4ff00') : RAISED_BTN}
          >
            {i < value.length ? '●' : ''}
          </div>
        ))}
      </div>
      <div className="grid grid-cols-3 gap-2.5">
        {['1', '2', '3', '4', '5', '6', '7', '8', '9', '', '0', '⌫'].map((d, i) =>
          d === '' ? <div key={i} /> : (
            <button
              key={i}
              type="button"
              onClick={() => (d === '⌫' ? onBackspace() : onDigit(d))}
              className="flex h-14 w-14 items-center justify-center rounded-full text-[16px] font-extrabold text-white/85 transition-transform active:scale-90"
              style={RAISED_BTN}
            >
              {d}
            </button>
          ),
        )}
      </div>
    </div>
  )
}

function NewProfileForm({ onCreate, onCancel }: { onCreate: (p: DjProfile) => void; onCancel: () => void }) {
  const [name, setName] = useState('')
  const [photo, setPhoto] = useState<string | null>(null)
  const [pin, setPin] = useState('')
  const [pinConfirm, setPinConfirm] = useState('')
  const [stage, setStage] = useState<'pin' | 'confirm'>('pin')
  const [error, setError] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  const handlePhoto = useCallback(async (file: File) => {
    try { setPhoto(await resizePhoto(file)) } catch { setError('No se pudo usar esa imagen') }
  }, [])

  const handleDigit = (d: string) => {
    setError(null)
    if (stage === 'pin') {
      if (pin.length >= 4) return
      const next = pin + d
      setPin(next)
      if (next.length === 4) setStage('confirm')
    } else {
      if (pinConfirm.length >= 4) return
      const next = pinConfirm + d
      setPinConfirm(next)
      if (next.length === 4) {
        if (next !== pin) { setError('El PIN no coincide — probá de nuevo'); setPin(''); setPinConfirm(''); setStage('pin'); return }
        if (!name.trim()) { setError('Ponele un nombre primero'); return }
        onCreate({ id: `dj-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, name: name.trim(), pin: next, photo })
      }
    }
  }
  const handleBackspace = () => {
    setError(null)
    if (stage === 'pin') setPin((p) => p.slice(0, -1))
    else setPinConfirm((p) => p.slice(0, -1))
  }

  return (
    <div className="relative flex w-full max-w-sm flex-col items-center gap-4 rounded-2xl p-6" style={METAL_PANEL}>
      <MetalGrain />
      <span className="relative text-[13px] font-bold text-white">+ Nuevo DJ</span>
      <button type="button" onClick={() => fileRef.current?.click()} className="relative flex h-24 w-24 items-center justify-center overflow-hidden rounded-full" style={RAISED_BTN}>
        {photo ? <img src={photo} alt="Tu foto" className="h-full w-full object-cover" /> : <span className="text-[10px] text-white/40">Foto</span>}
      </button>
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => { const f = e.target.files?.[0]; if (f) void handlePhoto(f); e.target.value = '' }}
      />
      <input
        type="text"
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="Tu nombre de DJ"
        className="relative w-full rounded-lg px-3 py-2 text-center text-[12px] text-white placeholder:text-white/30 focus:outline-none"
        style={{ background: '#050608', boxShadow: 'inset 0 1px 3px rgba(0,0,0,0.7), inset 0 0 0 1px rgba(255,255,255,0.08)' }}
      />
      <span className="relative text-[9.5px] text-white/40">{stage === 'pin' ? 'Elegí un PIN de 4 dígitos' : 'Repetilo para confirmar'}</span>
      <div className="relative">
        <PinPad value={stage === 'pin' ? pin : pinConfirm} onDigit={handleDigit} onBackspace={handleBackspace} />
      </div>
      {error && <span className="relative text-[10px] font-semibold text-red-300">{error}</span>}
      <button type="button" onClick={onCancel} className="relative text-[10px] text-white/40 hover:text-white/70">Cancelar</button>
    </div>
  )
}

/**
 * Pantalla de entrada — bloquea el acceso a `DjIaScreen` hasta que
 * alguien elige su perfil (por foto) y pone su PIN correcto. Todo
 * local (`localStorage`), sin servidor — varios DJs distintos pueden
 * compartir la misma app instalada, cada uno con su propio perfil.
 */
export function ProfileGate({ onEnter }: { onEnter: (profile: DjProfile) => void }) {
  const [profiles, setProfiles] = useState<DjProfile[]>(() => readProfiles())
  const [creating, setCreating] = useState(profiles.length === 0)
  const [unlocking, setUnlocking] = useState<DjProfile | null>(null)
  const [pin, setPin] = useState('')
  const [error, setError] = useState(false)

  const handleCreate = (p: DjProfile) => {
    const next = [...profiles, p]
    setProfiles(next)
    writeProfiles(next)
    setCreating(false)
    onEnter(p)
  }

  const handleDigit = (d: string) => {
    if (!unlocking || pin.length >= 4) return
    const next = pin + d
    setPin(next)
    if (next.length === 4) {
      if (next === unlocking.pin) { onEnter(unlocking); return }
      setError(true)
      setTimeout(() => { setPin(''); setError(false) }, 500)
    }
  }

  if (creating) {
    return (
      <div className="flex h-full w-full items-center justify-center bg-black p-4">
        <NewProfileForm onCreate={handleCreate} onCancel={() => setCreating(false)} />
      </div>
    )
  }

  if (unlocking) {
    return (
      <div className="flex h-full w-full flex-col items-center justify-center gap-4 bg-black p-4">
        <div className="relative flex h-24 w-24 items-center justify-center overflow-hidden rounded-full" style={raisedActive(GLOW[0])}>
          {unlocking.photo ? <img src={unlocking.photo} alt={unlocking.name} className="h-full w-full object-cover" /> : <span className="text-[22px] font-bold text-white">{unlocking.name[0]?.toUpperCase()}</span>}
        </div>
        <span className="text-[13px] font-bold text-white">{unlocking.name}</span>
        <span className={`text-[9.5px] ${error ? 'text-red-300' : 'text-white/40'}`}>{error ? 'PIN incorrecto' : 'Ingresá tu PIN'}</span>
        <PinPad value={pin} onDigit={handleDigit} onBackspace={() => setPin((p) => p.slice(0, -1))} />
        <button type="button" onClick={() => { setUnlocking(null); setPin(''); setError(false) }} className="text-[10px] text-white/40 hover:text-white/70">← otro perfil</button>
      </div>
    )
  }

  return (
    <div className="flex h-full w-full flex-col items-center justify-center gap-6 bg-black p-4">
      <span className="text-[15px] font-bold text-white">¿Quién sos?</span>
      <div className="grid grid-cols-3 gap-4">
        {profiles.map((p, i) => (
          <button
            key={p.id}
            type="button"
            onClick={() => setUnlocking(p)}
            className="flex flex-col items-center gap-2 transition-transform active:scale-95"
          >
            <div className="flex h-20 w-20 items-center justify-center overflow-hidden rounded-full" style={raisedActive(GLOW[i % GLOW.length])}>
              {p.photo ? <img src={p.photo} alt={p.name} className="h-full w-full object-cover" /> : <span className="text-[20px] font-bold text-white">{p.name[0]?.toUpperCase()}</span>}
            </div>
            <span className="text-[11px] font-semibold text-white/80">{p.name}</span>
          </button>
        ))}
        <button type="button" onClick={() => setCreating(true)} className="flex flex-col items-center gap-2">
          <div className="flex h-20 w-20 items-center justify-center rounded-full text-[26px] text-white/50" style={RAISED_BTN}>+</div>
          <span className="text-[11px] font-semibold text-white/50">Nuevo DJ</span>
        </button>
      </div>
    </div>
  )
}
