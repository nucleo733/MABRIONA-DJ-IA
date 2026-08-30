export {}

declare global {
  interface Window {
    djia: {
      searchYoutube: (query: string, opts?: { safe?: boolean }) => Promise<{ ok: boolean; status: number; data: unknown }>
      checkYoutubeVideo: (id: string) => Promise<{ ok: boolean; status: number; data: unknown }>
      checkForUpdate: () => Promise<{ updateAvailable: boolean; latestVersion?: string; url?: string }>
      platform: string
      separateStems: (payload: { ch0: ArrayBuffer; ch1: ArrayBuffer; length: number }) => Promise<Record<'voz' | 'bateria' | 'bajo' | 'resto', { ch0: ArrayBuffer; ch1: ArrayBuffer }>>
      onStemsProgress: (cb: (evt: { phase: string; ratio: number }) => void) => () => void
    }
  }
}
