import { createClient } from '@supabase/supabase-js'

/**
 * Mismo proyecto real de Supabase que usa mabriona.com (CIELO) — no
 * es un backend nuevo para MATOKO DJ. La anon key es pública a
 * propósito (la protección real es Row Level Security en las tablas,
 * ya configurado ahí: `profiles` es de lectura pública, escritura
 * solo del dueño). Se usa para: login anónimo del DJ que elige
 * ponerse un `username` público, buscar otros DJs por nombre, y
 * mandar/recibir canciones en vivo por Supabase Realtime (mismo
 * patrón de canales broadcast que ya usa CIELO para señalización).
 */
const SUPABASE_URL = 'https://mfdzlhqhtkoxytwzaqfq.supabase.co'
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1mZHpsaHFodGtveHl0d3phcWZxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODc1NzY3MjEsImV4cCI6MjEwMzE1MjcyMX0.eLBGkF2doJXbXHXsB0tPS_oc6KL_l1BwbiF1G8e4rE8'

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    // Persiste la sesión anónima en `localStorage` bajo una clave
    // propia (no pisa nada de `dj-ia:*`) — así el DJ no tiene que
    // volver a "loguearse" cada vez que abre la app.
    storageKey: 'matoko-dj-supabase-auth',
    persistSession: true,
    autoRefreshToken: true,
  },
})
