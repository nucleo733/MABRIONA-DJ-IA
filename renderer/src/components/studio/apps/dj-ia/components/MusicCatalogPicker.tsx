import { IconMusic } from '../../../../shared/icons'

/**
 * Stub de "Música de MABRIONA" para la app de escritorio standalone —
 * ese origen depende del catálogo de artista en Supabase (cuenta
 * logueada), que queda fuera de esta app. Mismo path/props que el
 * componente real de mabriona.com para no tocar DjIaScreen.tsx.
 */
export function MusicCatalogPicker({}: {
  accountId: string | null
  onLoadToDeck: (file: File, title: string, deck: 1 | 2) => void
  onAddToAutoMix: (file: File, title: string) => void
}) {
  return (
    <div className="flex flex-col items-center gap-2 px-3 py-6 text-center text-white/40">
      <IconMusic className="h-5 w-5" />
      <p className="text-[11px] leading-snug">No disponible en la app de escritorio — usa mabriona.com.</p>
    </div>
  )
}
