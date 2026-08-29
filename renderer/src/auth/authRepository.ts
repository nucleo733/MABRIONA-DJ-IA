import type { Role } from './types'

/**
 * Persistencia real de sesión/cuenta OWNER — mismo criterio que el
 * resto de MABRIONA STUDIO (`MusicProjectRepository`, `continueListeningRepository`):
 * localStorage es la "base de datos" real de esta app hoy (no hay
 * backend desplegado con auth propia todavía — `server/` es un
 * esqueleto de arquitectura, sin endpoints públicos ni auth real). El
 * OWNER se configura una sola vez (primer uso) en el navegador desde
 * el que administra la plataforma.
 */
export interface OwnerAccount {
  id: string
  email: string
  passwordHash: string
}

export interface UserAccount {
  id: string
  email: string
  passwordHash: string
}

export interface Session {
  role: Role
  email: string
  accountId: string
}

const OWNER_KEY = 'mabriona:auth:owner-account:v1'
const USERS_KEY = 'mabriona:auth:users:v1'
const SESSION_KEY = 'mabriona:auth:session:v1'

/**
 * Identidad estable de la cuenta — NO es el email (sección 15 de
 * `docs/ARQUITECTURA-PLATAFORMA-MABRIONA.md`: "no usar email como
 * foreign key principal", porque el email puede cambiar y porque dos
 * cuentas nunca deben poder mezclar sus datos por una coincidencia de
 * string). Todo lo que un usuario "posee" (perfiles, catálogo de
 * artista) debe referenciar este `id`, nunca el email de sesión.
 */
export function generateAccountId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID()
  return `acc-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

/**
 * Cuentas creadas ANTES de que existiera `id` no lo tienen todavía —
 * se le asigna uno la primera vez que se lee y se persiste de vuelta
 * (backfill perezoso, no destructivo: nunca se pierde una cuenta real
 * ya existente por este cambio).
 */
export function getOwnerAccount(): OwnerAccount | null {
  if (typeof localStorage === 'undefined') return null
  const raw = localStorage.getItem(OWNER_KEY)
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw) as OwnerAccount
    if (parsed.id) return parsed
    const withId: OwnerAccount = { ...parsed, id: generateAccountId() }
    setOwnerAccount(withId)
    return withId
  } catch {
    return null
  }
}

export function setOwnerAccount(account: OwnerAccount): void {
  if (typeof localStorage === 'undefined') return
  localStorage.setItem(OWNER_KEY, JSON.stringify(account))
}

export function clearOwnerAccount(): void {
  if (typeof localStorage === 'undefined') return
  localStorage.removeItem(OWNER_KEY)
}

/**
 * Cuentas de usuario normal — completamente separadas de la cuenta
 * OWNER (`OWNER_KEY`/`getOwnerAccount`). Registro libre por email,
 * sin código secreto (ese código es exclusivo del alta del CEO).
 */
export function getUsers(): UserAccount[] {
  if (typeof localStorage === 'undefined') return []
  const raw = localStorage.getItem(USERS_KEY)
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    let backfilled = false
    const withIds: UserAccount[] = (parsed as UserAccount[]).map((u) => {
      if (u.id) return u
      backfilled = true
      return { ...u, id: generateAccountId() }
    })
    if (backfilled) localStorage.setItem(USERS_KEY, JSON.stringify(withIds))
    return withIds
  } catch {
    return []
  }
}

export function findUserAccount(email: string): UserAccount | null {
  const normalized = email.trim().toLowerCase()
  return getUsers().find((u) => u.email.toLowerCase() === normalized) ?? null
}

/**
 * Resuelve el email real de una cuenta a partir de su `accountId` —
 * necesario para notificar a un artista seguido (sección 19 de
 * `docs/FASE-EXPANSION-PERFIL-ARTISTA.md`: la cuenta que sigue no es
 * la misma que recibe la notificación, así que no alcanza con
 * `getSession()`). Busca en OWNER y en usuarios normales.
 */
export function findAccountEmailById(accountId: string): string | null {
  const owner = getOwnerAccount()
  if (owner?.id === accountId) return owner.email
  return getUsers().find((u) => u.id === accountId)?.email ?? null
}

export function addUserAccount(account: UserAccount): void {
  if (typeof localStorage === 'undefined') return
  const users = getUsers()
  users.push(account)
  localStorage.setItem(USERS_KEY, JSON.stringify(users))
}

export function setUserPassword(email: string, passwordHash: string): void {
  if (typeof localStorage === 'undefined') return
  const normalized = email.trim().toLowerCase()
  const users = getUsers()
  const account = users.find((u) => u.email.toLowerCase() === normalized)
  if (!account) return
  account.passwordHash = passwordHash
  localStorage.setItem(USERS_KEY, JSON.stringify(users))
}

/**
 * Reemplaza el hash guardado de una cuenta existente — recuperación de
 * contraseña real (no toca email, id ni ningún otro dato de la
 * cuenta). Equivalente en efecto a `setUserPassword` de arriba (dos
 * sesiones concurrentes construyeron recuperación de contraseña por
 * separado) — se conserva porque otro código ya puede depender de
 * este nombre/firma (`boolean` de éxito en vez de `void`).
 */
export function updateUserPasswordHash(email: string, passwordHash: string): boolean {
  if (typeof localStorage === 'undefined') return false
  const normalized = email.trim().toLowerCase()
  const users = getUsers()
  const index = users.findIndex((u) => u.email.toLowerCase() === normalized)
  if (index === -1) return false
  users[index] = { ...users[index], passwordHash }
  localStorage.setItem(USERS_KEY, JSON.stringify(users))
  return true
}

/**
 * Backfill de sesiones ya guardadas ANTES de que `Session` tuviera
 * `accountId` (navegadores con una sesión OWNER/usuario ya activa al
 * momento de este cambio) — se resuelve una sola vez contra la cuenta
 * real y se persiste, sin forzar un logout.
 */
export function getSession(): Session | null {
  if (typeof localStorage === 'undefined') return null
  const raw = localStorage.getItem(SESSION_KEY)
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw) as Session
    if (parsed.accountId) return parsed
    const accountId = parsed.role === 'owner' ? getOwnerAccount()?.id : findUserAccount(parsed.email)?.id
    if (!accountId) return parsed
    const withId: Session = { ...parsed, accountId }
    setSession(withId)
    return withId
  } catch {
    return null
  }
}

export function setSession(session: Session | null): void {
  if (typeof localStorage === 'undefined') return
  if (session) localStorage.setItem(SESSION_KEY, JSON.stringify(session))
  else localStorage.removeItem(SESSION_KEY)
}

/**
 * Reescribe el `id` local de una cuenta ya existente — usado por la
 * Fase 18 cuando una cuenta vieja (accountId generado localmente) se
 * migra a su identidad real de Supabase Auth (`auth.uid()`). Nunca
 * cambia email ni passwordHash, solo el id — el resto del código
 * (`findAccountEmailById`, etc.) sigue funcionando igual, ahora
 * resolviendo el id real.
 */
export function rekeyUserAccountId(email: string, newId: string): void {
  if (typeof localStorage === 'undefined') return
  const normalized = email.trim().toLowerCase()
  const users = getUsers()
  const index = users.findIndex((u) => u.email.toLowerCase() === normalized)
  if (index === -1) return
  users[index] = { ...users[index], id: newId }
  localStorage.setItem(USERS_KEY, JSON.stringify(users))
}

export function rekeyOwnerAccountId(newId: string): void {
  const owner = getOwnerAccount()
  if (!owner) return
  setOwnerAccount({ ...owner, id: newId })
}
