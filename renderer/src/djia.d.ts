export {}

declare global {
  interface Window {
    djia: {
      searchYoutube: (query: string, opts?: { safe?: boolean }) => Promise<{ ok: boolean; status: number; data: unknown }>
      checkYoutubeVideo: (id: string) => Promise<{ ok: boolean; status: number; data: unknown }>
    }
  }
}
