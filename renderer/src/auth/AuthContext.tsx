import { createContext, useContext, type ReactNode } from 'react'

/**
 * `accountId` real del perfil de DJ logueado (`ProfileGate.tsx`) — ya
 * no es siempre `null` como cuando esta app no tenía perfiles. El
 * resto de `DjIaScreen.tsx` (historial/colas namespaceadas por
 * `djiaAccountKey = auth.accountId ?? 'guest'`) no necesitó ningún
 * cambio: empezó a aislar por DJ solo con que esto deje de ser fijo.
 */
interface AuthState {
  accountId: string | null
}

const AuthContext = createContext<AuthState>({ accountId: null })

export function AuthProvider({ accountId, children }: { accountId: string | null; children: ReactNode }) {
  return <AuthContext.Provider value={{ accountId }}>{children}</AuthContext.Provider>
}

export function useAuth(): AuthState {
  return useContext(AuthContext)
}
