import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import { AuthProvider } from './auth/AuthContext'
import { DjIaScreen } from './components/studio/apps/dj-ia/DjIaScreen'

const BRAND_BAR_HEIGHT = 40

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

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AuthProvider>
      <div className="flex h-screen w-full flex-col bg-black text-white">
        {isMac && <BrandBar />}
        <div className="min-h-0 flex-1 overflow-auto" style={isMac ? { height: `calc(100vh - ${BRAND_BAR_HEIGHT}px)` } : undefined}>
          <DjIaScreen />
        </div>
      </div>
    </AuthProvider>
  </StrictMode>,
)
