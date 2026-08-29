import { useCallback, useRef, type PointerEvent } from 'react'
import type { DeckEngine } from '../engine/useDeckEngine'

const BASE_SECONDS_PER_REVOLUTION = 3

function fmtTime(s: number): string {
  const m = Math.floor(s / 60)
  const sec = (s % 60).toFixed(1).padStart(4, '0')
  return `${m.toString().padStart(2, '0')}:${sec}`
}

export interface YtOverride {
  videoId: string
  isPlaying: boolean
  currentTime: number
  duration: number
  title: string
  status: 'conectando' | 'listo' | 'error'
  error: string | null
  bpm: number | null
}

/**
 * Jog wheel real: arrastrarlo hace scratch/scrub (ángulo → segundos)
 * en pausa o reproduciendo. El platillo central es un disco grande que
 * gira de verdad mientras suena (vinilo real, no decorativo), con
 * bisel cromado y pantalla LCD fija con BPM, tiempo y mini forma de
 * onda — acabado realista tipo controlador de gama alta.
 *
 * `ytOverride`: cuando este deck tiene un video de YouTube asignado
 * (en vez de un archivo de audio real), el plato gira sincronizado
 * con el play/pause real del video (vía YouTube IFrame API) — no hay
 * scratch (no hay buffer que mover), pero el giro y la pantalla sí
 * reflejan el estado real del video.
 */
export type RingLightEffect = 'static' | 'pulse' | 'chase' | 'strobe'

export function JogWheel({ num, color, engine, sensitivity = 1, ytOverride, lightEffect = 'static' }: { num: number; color: string; engine: DeckEngine; sensitivity?: number; ytOverride?: YtOverride | null; lightEffect?: RingLightEffect }) {
  const wheelRef = useRef<HTMLDivElement | null>(null)
  const lastAngleRef = useRef<number | null>(null)

  const angleAt = useCallback((clientX: number, clientY: number) => {
    const el = wheelRef.current
    if (!el) return 0
    const rect = el.getBoundingClientRect()
    return Math.atan2(clientY - (rect.top + rect.height / 2), clientX - (rect.left + rect.width / 2))
  }, [])

  const onPointerDown = useCallback((e: PointerEvent<HTMLDivElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId)
    lastAngleRef.current = angleAt(e.clientX, e.clientY)
  }, [angleAt])

  const onPointerMove = useCallback((e: PointerEvent<HTMLDivElement>) => {
    if (lastAngleRef.current == null) return
    const angle = angleAt(e.clientX, e.clientY)
    let delta = angle - lastAngleRef.current
    if (delta > Math.PI) delta -= 2 * Math.PI
    if (delta < -Math.PI) delta += 2 * Math.PI
    lastAngleRef.current = angle
    // Con YouTube no hay buffer que scratchear de verdad, pero
    // `engine` ya es el motor real de YouTube en ese caso — arrastrar
    // el plato SÍ mueve el video de verdad (seekTo), igual que un
    // plato real mueve el audio.
    engine.nudge((delta / (2 * Math.PI)) * BASE_SECONDS_PER_REVOLUTION * sensitivity)
  }, [angleAt, engine, sensitivity])

  const onPointerUp = useCallback(() => { lastAngleRef.current = null }, [])

  const isPlaying = ytOverride ? ytOverride.isPlaying : engine.isPlaying
  const progress = ytOverride
    ? (ytOverride.duration > 0 ? ytOverride.currentTime / ytOverride.duration : 0)
    : (engine.duration > 0 ? engine.currentTime / engine.duration : 0)
  const displayBpm = engine.bpm ? engine.bpm * (1 + engine.pitch * (engine.tempoRangePct / 100)) : null
  const ringBpm = ytOverride ? ytOverride.bpm : displayBpm
  const beatSeconds = 60 / (ringBpm && ringBpm > 20 ? ringBpm : 120)
  const ringActive = isPlaying && lightEffect !== 'static'
  const ringAnimClass = ringActive ? (lightEffect === 'pulse' ? 'dj-ring-pulse' : lightEffect === 'strobe' ? 'dj-ring-strobe' : '') : ''
  const ringAnimStyle: React.CSSProperties = ringActive && (lightEffect === 'pulse' || lightEffect === 'strobe')
    ? { animation: `${ringAnimClass} ${beatSeconds}s ease-in-out infinite` }
    : {}

  return (
    <div
      ref={wheelRef}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      className="relative flex aspect-square w-full shrink-0 cursor-grab touch-none select-none items-center justify-center rounded-full active:cursor-grabbing"
      style={{
        background: 'linear-gradient(155deg, #4a4d54 0%, #1c1e22 14%, #0c0d0f 100%)',
        boxShadow: '0 0 0 1px rgba(0,0,0,0.7), 0 30px 60px rgba(0,0,0,0.7), 0 8px 18px rgba(0,0,0,0.5), inset 0 2px 3px rgba(255,255,255,0.25), inset 0 -6px 14px rgba(0,0,0,0.55)',
      }}
    >
      {/* bisel cromado — aro metálico exterior con grano cepillado, referencia hardware real */}
      <div
        className="pointer-events-none absolute inset-[3px] rounded-full opacity-95"
        style={{ background: 'conic-gradient(from 200deg, #f4f5f7 0deg, #7a7d84 40deg, #26282c 90deg, #8a8d94 150deg, #f4f5f7 190deg, #5c5f66 260deg, #101114 320deg, #f4f5f7 360deg)' }}
        aria-hidden="true"
      />
      <div
        className="pointer-events-none absolute inset-[3px] rounded-full opacity-30 mix-blend-overlay"
        style={{
          backgroundImage:
            "url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='90' height='90'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='2'/><feColorMatrix type='matrix' values='0 0 0 0 1  0 0 0 0 1  0 0 0 0 1  0 0 0 0.5 0'/></filter><rect width='100%25' height='100%25' filter='url(%23n)'/></svg>\")",
        }}
        aria-hidden="true"
      />
      {/* remaches del bisel — 8 tornillos metálicos, mismo detalle de hardware manufacturado */}
      {Array.from({ length: 8 }).map((_, i) => (
        <span
          key={i}
          className="pointer-events-none absolute left-1/2 top-1/2 h-[5px] w-[5px] rounded-full"
          style={{
            background: 'radial-gradient(circle at 35% 30%, #e8e9ec, #6a6d74 55%, #222327 100%)',
            boxShadow: '0 1px 1px rgba(0,0,0,0.7), inset 0 0 0 1px rgba(0,0,0,0.4)',
            transform: `rotate(${i * 45}deg) translateY(-49%) translateX(-50%)`,
            transformOrigin: '50% 0',
          }}
        />
      ))}

      <div className="pointer-events-none absolute inset-[7px] rounded-full" style={{ background: '#0a0b0c', boxShadow: 'inset 0 3px 6px rgba(0,0,0,0.85), inset 0 -1px 0 rgba(255,255,255,0.06), 0 2px 5px rgba(0,0,0,0.6)' }} aria-hidden="true" />

      {/* El platillo: disco grande con textura de vinilo (surcos concéntricos reales) que gira de verdad mientras suena */}
      <div className="pointer-events-none absolute inset-[12px] rounded-full" style={{ boxShadow: 'inset 0 3px 8px rgba(0,0,0,0.7)' }} />
      <div
        className="pointer-events-none absolute inset-[13px] overflow-hidden rounded-full"
        style={{ animation: isPlaying ? 'orbital-ring-cw 1.8s linear infinite' : 'none' }}
      >
        <div
          className="absolute inset-0"
          style={{ background: 'repeating-radial-gradient(circle at 50% 50%, #1c1d20 0px, #26282c 1.2px, #121317 2.4px, #0e0f11 3.6px, #1a1b1e 4.8px)' }}
        />
      </div>

      <div
        className={`pointer-events-none absolute inset-[15px] rounded-full ${ringAnimClass}`}
        style={{ boxShadow: `0 0 0 1.5px ${color}99, 0 0 10px ${color}55, inset 0 0 10px ${color}25`, ...ringAnimStyle }}
      />
      {ringActive && lightEffect === 'chase' && (
        <div className="pointer-events-none absolute inset-[15px] overflow-hidden rounded-full" style={{ animation: `orbital-ring-cw ${beatSeconds * 2}s linear infinite` }}>
          <div className="absolute inset-0" style={{ background: `conic-gradient(from 0deg, transparent 0deg, ${color} 8deg, transparent 40deg)` }} />
        </div>
      )}

      <svg className="pointer-events-none absolute inset-[19px] h-[calc(100%-38px)] w-[calc(100%-38px)] -rotate-90" viewBox="0 0 100 100" aria-hidden="true">
        <circle cx="50" cy="50" r="47" fill="none" stroke="rgba(0,0,0,0.35)" strokeWidth="2" />
        <circle cx="50" cy="50" r="47" fill="none" stroke={color} strokeWidth="2.5" strokeDasharray={`${progress * 295} 295`} strokeLinecap="round" style={{ filter: `drop-shadow(0 0 3px ${color})` }} />
      </svg>

      {/* Pantalla LCD fija (no gira) — número de deck, BPM, tiempo y mini forma de onda */}
      <div
        className="pointer-events-none relative flex aspect-square w-[58%] flex-col items-center justify-center gap-[3px] overflow-hidden rounded-full"
        style={{
          background: 'radial-gradient(circle at 35% 25%, #10151a 0%, #05070a 60%, #020304 100%)',
          boxShadow: 'inset 0 0 0 3px #000, inset 0 4px 14px rgba(0,0,0,0.9), 0 0 0 1px rgba(255,255,255,0.08)',
        }}
      >
        <div className="pointer-events-none absolute -inset-x-1/4 -top-1/2 h-3/4 rounded-full opacity-20" style={{ background: 'radial-gradient(closest-side, rgba(255,255,255,0.7), transparent 70%)' }} />
        {/* vidrio real de la pantalla — brillo diagonal en movimiento, mismo tratamiento que el resto de pantallas de la consola */}
        <div
          className="pointer-events-none absolute -inset-y-1/2 -left-1/2 w-1/2 rotate-[18deg] animate-[dj-glass-sheen_5s_ease-in-out_infinite] opacity-60 motion-reduce:animate-none"
          style={{ background: 'linear-gradient(100deg, transparent, rgba(255,255,255,0.4) 45%, transparent 65%)' }}
        />
        <div className="pointer-events-none absolute inset-0 rounded-full shadow-[inset_0_1px_0_rgba(255,255,255,0.2)]" />

        {ytOverride ? (
          <>
            {/* El mismo video real de la pantalla de arriba, recortado en círculo — mudo (el audio ya suena arriba) pero visualmente sincronizado. clip-path + border-radius directo en el iframe (no solo en el contenedor) para que el recorte circular sea real en todos los navegadores, no un rectángulo asomando por los bordes. */}
            <div className="pointer-events-none absolute inset-0 overflow-hidden rounded-full">
              {ytOverride.isPlaying && (
                <iframe
                  key={ytOverride.videoId}
                  className="pointer-events-none absolute left-1/2 top-1/2 h-[140%] w-[140%] -translate-x-1/2 -translate-y-1/2 border-0"
                  style={{ borderRadius: '50%', clipPath: 'circle(50% at 50% 50%)' }}
                  src={`https://www.youtube.com/embed/${ytOverride.videoId}?autoplay=1&mute=1&controls=0&playsinline=1&modestbranding=1`}
                  allow="autoplay; encrypted-media"
                  title="mini"
                />
              )}
            </div>
            <div className="pointer-events-none absolute inset-0 rounded-full bg-black/45" />
            <span className="relative z-10 font-mono text-[11px] font-bold tracking-tight" style={{ color: '#5fe3ff', textShadow: '0 0 6px #5fe3ff99' }}>
              {ytOverride.bpm ? ytOverride.bpm.toFixed(1) : '---.-'}
            </span>
            <span className="relative z-10 text-xl font-black text-white drop-shadow-[0_1px_3px_rgba(0,0,0,0.95)]">{num}</span>
            <span className="relative z-10 max-w-[80%] truncate rounded px-1 font-mono text-[7px] font-bold tracking-tight" style={{ color: '#ffb454', background: 'rgba(0,0,0,0.5)', textShadow: '0 0 5px #ffb45499' }}>
              {ytOverride.title}
            </span>
            <span className="relative z-10 rounded px-1 font-mono text-[7px] font-bold tracking-tight text-white" style={{ background: 'rgba(0,0,0,0.5)' }}>
              {fmtTime(ytOverride.currentTime)} / {fmtTime(ytOverride.duration)}
            </span>
            {ytOverride.status !== 'listo' && (
              <span
                className="relative z-10 max-w-[85%] rounded px-1.5 py-0.5 text-center font-mono text-[7px] font-bold tracking-tight"
                style={ytOverride.status === 'error' ? { color: '#fff', background: 'rgba(220,38,38,0.85)' } : { color: '#000', background: 'rgba(255,255,255,0.85)' }}
              >
                {ytOverride.status === 'error' ? `ERROR: ${ytOverride.error}` : 'Conectando con YouTube…'}
              </span>
            )}
          </>
        ) : (
          <>
            {engine.isVideoTrack && engine.thumbnail && (
              <div className="pointer-events-none absolute inset-0 overflow-hidden rounded-full">
                <img src={engine.thumbnail} alt="" className="absolute inset-0 h-full w-full object-cover opacity-60" />
                <div className="absolute inset-0 bg-black/45" />
              </div>
            )}
            <span className="relative z-10 font-mono text-[11px] font-bold tracking-tight" style={{ color: '#5fe3ff', textShadow: '0 0 6px #5fe3ff99' }}>
              {displayBpm ? displayBpm.toFixed(1) : '---.-'}
            </span>
            <span className="relative z-10 text-2xl font-black text-white/95 drop-shadow-[0_1px_2px_rgba(0,0,0,0.8)]">{num}</span>
            <span className="relative z-10 font-mono text-[9px] font-bold tracking-tight" style={{ color: '#ffb454', textShadow: '0 0 5px #ffb45499' }}>
              {fmtTime(engine.currentTime)}
            </span>
            {engine.isVideoTrack ? (
              <span className="relative z-10 rounded px-1 font-mono text-[7px] font-bold tracking-tight text-white" style={{ background: 'rgba(0,0,0,0.5)' }}>
                🎥 VIDEO
              </span>
            ) : (
              <div className="relative z-10 mt-[1px] w-[72%]">
                {engine.peaks && (
                  <div className="flex h-2 items-end gap-px">
                    {engine.peaks.filter((_, i) => i % 12 === 0).map((h, i) => (
                      <span key={i} className="flex-1 rounded-[1px]" style={{ height: `${10 + h * 90}%`, background: i / 25 <= progress ? color : 'rgba(255,255,255,0.15)' }} />
                    ))}
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </div>

      <div className="pointer-events-none absolute inset-0 rounded-full" style={{ boxShadow: 'inset 0 0 34px rgba(0,0,0,0.55)' }} aria-hidden="true" />
    </div>
  )
}
