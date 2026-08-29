import { useEffect, useMemo, useState } from 'react'

/**
 * Motor de audio del mezclador: un único AudioContext, limitador
 * (DynamicsCompressor a modo brickwall) → master gain → balance →
 * destino, dos buses de crossfader (CH1/CH3 → A, CH2/CH4 → B), un bus
 * "booth" en paralelo y un bus de CUE (PFL) de auriculares. Todo Web
 * Audio real.
 */
export function useAudioEngine() {
  const [ctx] = useState<AudioContext>(() => new AudioContext())

  useEffect(() => () => void ctx.close(), [ctx])

  const limiter = useMemo(() => {
    const node = ctx.createDynamicsCompressor()
    node.threshold.value = -3
    node.knee.value = 0
    node.ratio.value = 20
    node.attack.value = 0.001
    node.release.value = 0.05
    node.connect(ctx.destination)
    return node
  }, [ctx])

  const balance = useMemo(() => ctx.createStereoPanner(), [ctx])
  const [balanceValue, setBalanceValueState] = useState(0)
  const setBalance = (v: number) => {
    setBalanceValueState(v)
    balance.pan.value = v
  }

  const masterGain = useMemo(() => {
    const g = ctx.createGain()
    g.gain.value = 0.9
    return g
  }, [ctx])

  const masterAnalyser = useMemo(() => {
    const a = ctx.createAnalyser()
    a.fftSize = 256
    a.smoothingTimeConstant = 0.6
    return a
  }, [ctx])

  const boothGain = useMemo(() => {
    const g = ctx.createGain()
    g.gain.value = 0.7
    return g
  }, [ctx])

  useEffect(() => {
    masterGain.disconnect()
    masterAnalyser.disconnect()
    balance.disconnect()
    masterGain.connect(masterAnalyser)
    masterAnalyser.connect(boothGain)
    masterAnalyser.connect(balance)
    balance.connect(limiter)
    return () => {
      masterGain.disconnect()
      masterAnalyser.disconnect()
      balance.disconnect()
    }
  }, [ctx, masterGain, masterAnalyser, boothGain, balance, limiter])

  const crossfadeA = useMemo(() => {
    const g = ctx.createGain()
    g.connect(masterGain)
    return g
  }, [ctx, masterGain])

  const crossfadeB = useMemo(() => {
    const g = ctx.createGain()
    g.connect(masterGain)
    return g
  }, [ctx, masterGain])

  // Crossfader real: -1 (todo A) .. 0 (centro) .. 1 (todo B). Curva
  // "scratch" (equal-power, corte más agresivo cerca del centro) u
  // "on" (lineal, mezcla más suave) — mismo par de curvas que trae
  // cualquier mezclador de club real.
  const [crossfaderValue, setCrossfaderValueState] = useState(0)
  const [crossfaderCurve, setCrossfaderCurveState] = useState<'linear' | 'power'>('power')
  const applyCrossfader = (v: number, curve: 'linear' | 'power') => {
    const x = (v + 1) / 2 // 0..1
    if (curve === 'linear') {
      crossfadeA.gain.value = 1 - x
      crossfadeB.gain.value = x
    } else {
      crossfadeA.gain.value = Math.cos(x * 0.5 * Math.PI)
      crossfadeB.gain.value = Math.cos((1 - x) * 0.5 * Math.PI)
    }
  }
  const setCrossfaderValue = (v: number) => { setCrossfaderValueState(v); applyCrossfader(v, crossfaderCurve) }
  const setCrossfaderCurve = (curve: 'linear' | 'power') => { setCrossfaderCurveState(curve); applyCrossfader(crossfaderValue, curve) }
  useEffect(() => applyCrossfader(crossfaderValue, crossfaderCurve), []) // eslint-disable-line react-hooks/exhaustive-deps

  const [masterLevel, setMasterLevelState] = useState(0.9)
  const setMasterLevel = (v: number) => { setMasterLevelState(v); masterGain.gain.value = v }
  const [boothLevel, setBoothLevelState] = useState(0.7)
  const setBoothLevel = (v: number) => { setBoothLevelState(v); boothGain.gain.value = v }
  const [limiterOn, setLimiterOnState] = useState(true)
  const setLimiterOn = (on: boolean) => {
    setLimiterOnState(on)
    // "bypass" real: ratio 1 (sin compresión) vs 20 (brickwall)
    limiter.ratio.value = on ? 20 : 1
    limiter.threshold.value = on ? -3 : 0
  }

  // Bus de CUE (PFL) — monitor de auriculares real: cada canal manda una
  // copia post-fader acá cuando su botón CUE está activo. Va directo al
  // destino (sin pasar por el limitador de master), mezclado por `cueMix`
  // contra una copia del master.
  const cueBus = useMemo(() => {
    const g = ctx.createGain()
    g.gain.value = 0.8
    return g
  }, [ctx])

  const cueMasterTap = useMemo(() => {
    const g = ctx.createGain()
    g.gain.value = 0
    masterAnalyser.connect(g)
    g.connect(ctx.destination)
    cueBus.connect(ctx.destination)
    return g
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ctx, cueBus, masterAnalyser])

  const [headphoneVolume, setHeadphoneVolumeState] = useState(0.8)
  const setHeadphoneVolume = (v: number) => {
    setHeadphoneVolumeState(v)
    cueBus.gain.value = v
  }
  const [cueMix, setCueMixState] = useState(0.2)
  const setCueMix = (v: number) => {
    setCueMixState(v)
    cueMasterTap.gain.value = v * headphoneVolume
  }

  return {
    ctx, masterGain, masterAnalyser, boothGain, balance: balanceValue, setBalance,
    crossfadeA, crossfadeB, cueBus,
    headphoneVolume, setHeadphoneVolume, cueMix, setCueMix,
    crossfaderValue, setCrossfaderValue, crossfaderCurve, setCrossfaderCurve,
    masterLevel, setMasterLevel, boothLevel, setBoothLevel, limiterOn, setLimiterOn,
  }
}

export type AudioEngine = ReturnType<typeof useAudioEngine>
