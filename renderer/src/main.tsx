import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import { AuthProvider } from './auth/AuthContext'
import { DjIaScreen } from './components/studio/apps/dj-ia/DjIaScreen'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AuthProvider>
      <div className="min-h-screen w-full bg-black text-white">
        <DjIaScreen />
      </div>
    </AuthProvider>
  </StrictMode>,
)
