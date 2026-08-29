import { createContext, useContext, type ReactNode } from 'react'

/**
 * Shim de auth para la app de escritorio standalone — el mezclador
 * corre siempre en modo invitado (mismo comportamiento que ya tiene
 * en mabriona.com sin cuenta logueada). No hay backend social/cuenta
 * en esta app, así que `accountId` es siempre `null`.
 */
interface AuthState {
  accountId: string | null
}

const AuthContext = createContext<AuthState>({ accountId: null })

export function AuthProvider({ children }: { children: ReactNode }) {
  return <AuthContext.Provider value={{ accountId: null }}>{children}</AuthContext.Provider>
}

export function useAuth(): AuthState {
  return useContext(AuthContext)
}
