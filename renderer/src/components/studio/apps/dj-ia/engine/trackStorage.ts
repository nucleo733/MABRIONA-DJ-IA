import type { LocalMusicTrack } from '../types'

/**
 * Persistencia real en IndexedDB de DJ IA — dos usos que comparten la
 * MISMA base (`mabriona-dj-ia`, ver regla de la Fase 2: "no crear una
 * segunda base de datos"):
 *
 * 1. `tracks` (v1, ya existía): la pista cargada en cada deck (A/B),
 *    guardada por slot — al refrescar la página, el archivo vuelve a
 *    estar cargado solo, sin autoplay.
 * 2. `library` (v2, Fase 2 — Smart Music Library): el registro
 *    persistente de la biblioteca local — un `File` + su metadata real
 *    por track, con identidad propia (independiente de qué deck lo
 *    tenga cargado). Ver `musicLibraryRepository.ts` para la lógica de
 *    identidad/duplicados/análisis que usa este store.
 */
const DB_NAME = 'mabriona-dj-ia'
const DB_VERSION = 2
const STORE_TRACKS = 'tracks'
const STORE_LIBRARY = 'library'

export interface LibraryRecord extends LocalMusicTrack {
  file: File
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(STORE_TRACKS)) db.createObjectStore(STORE_TRACKS)
      if (!db.objectStoreNames.contains(STORE_LIBRARY)) db.createObjectStore(STORE_LIBRARY, { keyPath: 'id' })
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

export async function saveTrack(key: string, file: File): Promise<void> {
  const db = await openDb()
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_TRACKS, 'readwrite')
    tx.objectStore(STORE_TRACKS).put(file, key)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
  db.close()
}

export async function loadTrack(key: string): Promise<File | null> {
  const db = await openDb()
  const file = await new Promise<File | null>((resolve, reject) => {
    const tx = db.transaction(STORE_TRACKS, 'readonly')
    const req = tx.objectStore(STORE_TRACKS).get(key)
    req.onsuccess = () => resolve((req.result as File | undefined) ?? null)
    req.onerror = () => reject(req.error)
  })
  db.close()
  return file
}

export async function putLibraryRecord(record: LibraryRecord): Promise<void> {
  const db = await openDb()
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_LIBRARY, 'readwrite')
    tx.objectStore(STORE_LIBRARY).put(record)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
  db.close()
}

export async function getLibraryRecord(id: string): Promise<LibraryRecord | null> {
  const db = await openDb()
  const record = await new Promise<LibraryRecord | null>((resolve, reject) => {
    const tx = db.transaction(STORE_LIBRARY, 'readonly')
    const req = tx.objectStore(STORE_LIBRARY).get(id)
    req.onsuccess = () => resolve((req.result as LibraryRecord | undefined) ?? null)
    req.onerror = () => reject(req.error)
  })
  db.close()
  return record
}

export async function listLibraryRecords(): Promise<LibraryRecord[]> {
  const db = await openDb()
  const records = await new Promise<LibraryRecord[]>((resolve, reject) => {
    const tx = db.transaction(STORE_LIBRARY, 'readonly')
    const req = tx.objectStore(STORE_LIBRARY).getAll()
    req.onsuccess = () => resolve((req.result as LibraryRecord[] | undefined) ?? [])
    req.onerror = () => reject(req.error)
  })
  db.close()
  return records
}

export async function deleteLibraryRecord(id: string): Promise<void> {
  const db = await openDb()
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_LIBRARY, 'readwrite')
    tx.objectStore(STORE_LIBRARY).delete(id)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
  db.close()
}
