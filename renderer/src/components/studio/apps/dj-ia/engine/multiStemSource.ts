export type StemName = 'voz' | 'bateria' | 'bajo' | 'resto'
export const STEM_NAMES: StemName[] = ['voz', 'bateria', 'bajo', 'resto']

export type StemBuffers = Record<StemName, AudioBuffer>

/**
 * Fachada que imita la parte de `AudioBufferSourceNode` que usa
 * `useDeckEngine.ts` (`playbackRate.value`, `loop`/`loopStart`/`loopEnd`,
 * `onended`, `start`, `stop`) pero por dentro maneja 4 fuentes reales — una
 * por stem — arrancadas con el mismo timestamp de `AudioContext` para que
 * queden en fase entre sí. Así el resto del motor (loop, hot cues, pitch,
 * scratch) sigue tocando `sourceRef.current` exactamente igual que hoy, sin
 * enterarse de que por dentro son 4 nodos en vez de 1.
 *
 * El volumen/mute de cada stem NO vive acá — vive en los `GainNode`
 * persistentes del deck (`stemGainRefs`), para que un toggle de "silenciar
 * voz" cambie el audio al instante sin tener que recrear las fuentes.
 */
export class MultiStemSource {
  private nodes: Record<StemName, AudioBufferSourceNode>
  private _loop = false
  private _loopStart = 0
  private _loopEnd = 0
  onended: (() => void) | null = null

  constructor(ctx: BaseAudioContext, buffers: StemBuffers, stemGains: Record<StemName, GainNode>) {
    this.nodes = STEM_NAMES.reduce((acc, stem) => {
      const node = ctx.createBufferSource()
      node.buffer = buffers[stem]
      node.connect(stemGains[stem])
      acc[stem] = node
      return acc
    }, {} as Record<StemName, AudioBufferSourceNode>)
    // Solo el primero dispara `onended` — las 4 fuentes arrancan/paran
    // siempre juntas, no hace falta que las 4 llamen al callback.
    this.nodes.voz.onended = () => this.onended?.()
  }

  get playbackRate() {
    const self = this
    return {
      get value() { return self.nodes.voz.playbackRate.value },
      set value(v: number) { STEM_NAMES.forEach((s) => { self.nodes[s].playbackRate.value = v }) },
    }
  }

  get loop() { return this._loop }
  set loop(v: boolean) { this._loop = v; STEM_NAMES.forEach((s) => { this.nodes[s].loop = v }) }
  get loopStart() { return this._loopStart }
  set loopStart(v: number) { this._loopStart = v; STEM_NAMES.forEach((s) => { this.nodes[s].loopStart = v }) }
  get loopEnd() { return this._loopEnd }
  set loopEnd(v: number) { this._loopEnd = v; STEM_NAMES.forEach((s) => { this.nodes[s].loopEnd = v }) }

  start(when: number, offset: number) {
    STEM_NAMES.forEach((s) => { this.nodes[s].start(when, offset) })
  }

  stop() {
    STEM_NAMES.forEach((s) => { try { this.nodes[s].stop() } catch { /* ya estaba detenido */ } })
  }
}
