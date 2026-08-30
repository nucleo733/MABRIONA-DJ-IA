import { StrictMode, useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import { AuthProvider } from './auth/AuthContext'
import { DjIaScreen } from './components/studio/apps/dj-ia/DjIaScreen'

const BRAND_BAR_HEIGHT = 40
const UPDATE_BANNER_HEIGHT = 36

/**
 * Sin auto-actualización real (requeriría firmar la app) — este banner
 * solo avisa si GitHub Releases tiene una versión más nueva que la
 * instalada, para que quien ya descargó MATOKO DJ se entere y la baje
 * de nuevo. Se puede cerrar; vuelve a aparecer recién en el próximo
 * arranque de la app.
 */
function UpdateBanner({ onVisibleChange }: { onVisibleChange: (visible: boolean) => void }) {
  const [update, setUpdate] = useState<{ latestVersion?: string; url?: string } | null>(null)
  const [dismissed, setDismissed] = useState(false)

  useEffect(() => {
    window.djia
      .checkForUpdate()
      .then((res) => {
        if (res.updateAvailable) setUpdate({ latestVersion: res.latestVersion, url: res.url })
      })
      .catch(() => {})
  }, [])

  const visible = !!update && !dismissed
  useEffect(() => onVisibleChange(visible), [visible, onVisibleChange])

  if (!visible) return null

  return (
    <div
      className="flex h-9 shrink-0 items-center justify-center gap-3 bg-volt px-4 text-xs font-semibold text-black"
      style={{ height: UPDATE_BANNER_HEIGHT }}
    >
      <span>Hay una versión nueva de MATOKO DJ (v{update.latestVersion}) disponible.</span>
      <a
        href={update.url}
        target="_blank"
        rel="noreferrer"
        className="rounded-full bg-black px-3 py-1 text-white underline-offset-2 hover:underline"
      >
        Descargar
      </a>
      <button type="button" onClick={() => setDismissed(true)} className="text-black/60 hover:text-black" aria-label="Cerrar aviso">
        ✕
      </button>
    </div>
  )
}

/**
 * Reemplaza la franja de título nativa de macOS (`titleBarStyle:
 * 'hidden'` en main.js) por una propia con el logo — los botones de
 * semáforo quedan flotando encima gracias a `trafficLightPosition`.
 * Solo se monta en macOS: en Windows/Linux la ventana sigue con su
 * barra nativa de sistema.
 */
function BrandBar() {
  return (
    <div
      className="flex h-10 shrink-0 items-center justify-center bg-gradient-to-r from-violet-500 to-sky-400"
      style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
    >
      <img src="/matoko-mark.png" alt="MATOKO DJ" className="h-7 w-7 rounded-full ring-1 ring-white/40 shadow-md" draggable={false} />
    </div>
  )
}

const isMac = window.djia.platform === 'darwin'

function App() {
  const [hasUpdateBanner, setHasUpdateBanner] = useState(false)
  const topBarsHeight = (isMac ? BRAND_BAR_HEIGHT : 0) + (hasUpdateBanner ? UPDATE_BANNER_HEIGHT : 0)

  return (
    <AuthProvider>
      <div className="flex h-screen w-full flex-col bg-black text-white">
        {isMac && <BrandBar />}
        <UpdateBanner onVisibleChange={setHasUpdateBanner} />
        <div className="min-h-0 flex-1 overflow-auto" style={topBarsHeight ? { height: `calc(100vh - ${topBarsHeight}px)` } : undefined}>
          <DjIaScreen />
        </div>
      </div>
    </AuthProvider>
  )
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
