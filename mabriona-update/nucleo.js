'use strict'

/**
 * MABRIONA UPDATE SYSTEM — núcleo de decisión.
 *
 * Fuente única de verdad de CUÁNDO corresponde una actualización y CUÁL.
 * No sabe descargar, ni instalar, ni de Electron: solo decide. Por eso se
 * puede probar de verdad, sin apps ni red, y por eso las tres aplicaciones
 * comparten exactamente el mismo criterio (FASE 24: nada de un updater por
 * producto).
 *
 * Lo usan tanto el endpoint del servidor como el cliente dentro de cada app,
 * así que las reglas se aplican dos veces sobre el mismo código.
 */

const CANALES = ['stable', 'beta', 'dev']
const PLATAFORMAS = ['macos', 'windows', 'linux']
const ARQUITECTURAS = ['x64', 'arm64', 'universal']

/** Convierte "1.10.2" en [1, 10, 2]. Devuelve null si no es semver válido. */
function partirVersion(v) {
  if (typeof v !== 'string') return null
  const m = /^(\d+)\.(\d+)\.(\d+)$/.exec(v.trim())
  if (!m) return null
  return [Number(m[1]), Number(m[2]), Number(m[3])]
}

/**
 * Compara dos versiones semver: -1 si a<b, 0 si iguales, 1 si a>b.
 * Compara número a número, nunca como texto: "1.10.0" es MAYOR que "1.9.0",
 * aunque alfabéticamente sea al revés. Ese error es la causa clásica de que un
 * updater ofrezca una versión vieja como si fuera nueva.
 */
function compararVersiones(a, b) {
  const pa = partirVersion(a)
  const pb = partirVersion(b)
  if (!pa || !pb) throw new Error(`Versión inválida: ${!pa ? a : b}`)
  for (let i = 0; i < 3; i++) {
    if (pa[i] > pb[i]) return 1
    if (pa[i] < pb[i]) return -1
  }
  return 0
}

/** Normaliza lo que informa Node (process.platform) al vocabulario del manifiesto. */
function plataformaDeNode(platform) {
  if (platform === 'darwin') return 'macos'
  if (platform === 'win32') return 'windows'
  if (platform === 'linux') return 'linux'
  return null
}

/**
 * Qué entradas del manifiesto puede recibir esta instalación.
 *
 * Una arquitectura `universal` sirve para cualquier Mac, así que un equipo
 * arm64 o x64 puede recibirla; al revés no: un binario x64 no se ofrece a
 * quien pidió arm64 si existe el nativo. Fuera de macOS no hay `universal`.
 */
function arquitecturasAceptadas(plataforma, arquitectura) {
  if (plataforma === 'macos') return [arquitectura, 'universal']
  return [arquitectura]
}

/**
 * Una actualización solo puede venir por HTTPS. La única excepción es la propia
 * máquina (127.0.0.1 / localhost), que es lo que usan las pruebas del ciclo
 * completo: ahí el tráfico no sale del equipo, así que no hay nada en el medio
 * que pueda alterarlo. Cualquier otro `http://` se descarta.
 */
function urlAceptable(url) {
  if (typeof url !== 'string') return false
  if (url.startsWith('https://')) return true
  return /^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?\//.test(url)
}

function validarConsulta(consulta) {
  const errores = []
  if (!consulta || typeof consulta !== 'object') return ['Consulta vacía']
  if (!consulta.producto) errores.push('Falta producto')
  if (!partirVersion(consulta.version)) errores.push(`Versión instalada inválida: ${consulta.version}`)
  if (!PLATAFORMAS.includes(consulta.plataforma)) errores.push(`Plataforma inválida: ${consulta.plataforma}`)
  if (!ARQUITECTURAS.includes(consulta.arquitectura)) errores.push(`Arquitectura inválida: ${consulta.arquitectura}`)
  if (consulta.canal && !CANALES.includes(consulta.canal)) errores.push(`Canal inválido: ${consulta.canal}`)
  return errores
}

/**
 * Decide si hay actualización para una instalación concreta.
 *
 * Devuelve siempre la MÁS ALTA que cumpla todas las reglas — no la última
 * publicada, que puede ser una corrección de una rama vieja.
 *
 * @returns {{hayActualizacion: boolean, release?: object, motivo?: string}}
 */
function decidirActualizacion(consulta, releases) {
  const errores = validarConsulta(consulta)
  if (errores.length) return { hayActualizacion: false, motivo: errores.join('; ') }

  const canal = consulta.canal || 'stable'
  const aceptadas = arquitecturasAceptadas(consulta.plataforma, consulta.arquitectura)

  const candidatas = (releases || []).filter((r) => {
    if (r.producto !== consulta.producto) return false
    if (r.plataforma !== consulta.plataforma) return false
    if (!aceptadas.includes(r.arquitectura)) return false
    // El canal se compara exacto: quien está en stable no recibe beta ni dev
    // por más nueva que sea la versión (FASE 13).
    if ((r.canal || 'stable') !== canal) return false
    if (r.retirado === true) return false
    if (!partirVersion(r.version)) return false
    // Solo hacia adelante.
    if (compararVersiones(r.version, consulta.version) <= 0) return false
    // Un salto que la versión instalada no soporta no se ofrece: primero hay
    // que pasar por una intermedia (o reinstalar).
    if (r.versionMinimaCompatible && compararVersiones(consulta.version, r.versionMinimaCompatible) < 0) return false
    if (typeof r.hash !== 'string' || !r.hash.startsWith('sha256:')) return false
    if (!urlAceptable(r.url)) return false
    return true
  })

  if (!candidatas.length) return { hayActualizacion: false, motivo: 'Ya estás en la última versión' }

  candidatas.sort((a, b) => compararVersiones(b.version, a.version))

  // Con varias arquitecturas empatadas en versión (nativa y universal), gana la
  // nativa: es la que rinde mejor en ese equipo.
  const mejorVersion = candidatas[0].version
  const empatadas = candidatas.filter((r) => r.version === mejorVersion)
  const nativa = empatadas.find((r) => r.arquitectura === consulta.arquitectura)

  return { hayActualizacion: true, release: nativa || empatadas[0] }
}

module.exports = {
  CANALES,
  PLATAFORMAS,
  ARQUITECTURAS,
  partirVersion,
  compararVersiones,
  plataformaDeNode,
  arquitecturasAceptadas,
  validarConsulta,
  urlAceptable,
  decidirActualizacion,
}
