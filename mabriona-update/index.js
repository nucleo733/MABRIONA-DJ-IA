'use strict'

/**
 * MABRIONA UPDATE SYSTEM — cliente único (FASES 5, 6, 19, 20).
 *
 * Esto es lo que integran las tres aplicaciones. No hay una versión de este
 * cliente por producto: cada app solo aporta su identidad (producto, versión,
 * canal) y el sistema hace el resto igual para todas.
 *
 * Privacidad (FASE 19): la consulta manda exactamente cinco datos —producto,
 * versión, plataforma, arquitectura y canal—, que son los mínimos para saber
 * qué archivo corresponde. Nada de identificadores de equipo, ni de usuario,
 * ni contadores. No hay nada que "desactivar" porque no se recoge.
 */

const os = require('node:os')
const path = require('node:path')
const nucleo = require('./nucleo')
const integridad = require('./integridad')
const aplicar = require('./aplicar')

const ENDPOINT_POR_DEFECTO = 'https://www.mabriona.com/api/update'

/** Traduce lo que informa Node a los valores del manifiesto. */
function detectarEntorno() {
  const plataforma = nucleo.plataformaDeNode(process.platform)
  // process.arch dice 'arm64' o 'x64'; en un Mac Intel corriendo bajo Rosetta
  // Node informa la arquitectura del proceso, que es la que hay que respetar:
  // ofrecerle arm64 a un proceso x64 sería darle un binario que no arranca.
  const arquitectura = process.arch === 'arm64' ? 'arm64' : 'x64'
  return { plataforma, arquitectura }
}

class ClienteActualizacion {
  /**
   * @param {object} opciones
   * @param {string} opciones.producto  'burbuja' | 'mabrio' | 'matoko-dj'
   * @param {string} opciones.version   versión instalada, semver
   * @param {string} [opciones.canal]   'stable' por defecto
   * @param {string} [opciones.endpoint]
   * @param {string} [opciones.carpetaTrabajo] dónde bajar y respaldar
   * @param {boolean} [opciones.firmada] true solo cuando exista Developer ID
   * @param {string} [opciones.rutaAppImage] ruta del AppImage en Linux
   */
  constructor(opciones) {
    if (!opciones || !opciones.producto) throw new Error('Falta el producto')
    if (!nucleo.partirVersion(opciones.version)) throw new Error(`Versión instalada inválida: ${opciones.version}`)
    const entorno = detectarEntorno()
    this.producto = opciones.producto
    this.version = opciones.version
    this.canal = opciones.canal || 'stable'
    this.endpoint = opciones.endpoint || ENDPOINT_POR_DEFECTO
    this.plataforma = opciones.plataforma || entorno.plataforma
    this.arquitectura = opciones.arquitectura || entorno.arquitectura
    this.firmada = Boolean(opciones.firmada)
    this.rutaAppImage = opciones.rutaAppImage || process.env.APPIMAGE || null
    this.carpetaTrabajo =
      opciones.carpetaTrabajo || path.join(os.tmpdir(), 'mabriona-update', this.producto)
    this.deps = opciones.deps || {}
  }

  /** Los cinco datos que viajan. Nada más. */
  consulta() {
    return {
      producto: this.producto,
      version: this.version,
      plataforma: this.plataforma,
      arquitectura: this.arquitectura,
      canal: this.canal,
    }
  }

  /**
   * Pregunta al sistema central si hay algo nuevo.
   * @returns {Promise<{hayActualizacion:boolean, release?:object, motivo?:string}>}
   */
  async revisar() {
    const traer = this.deps.fetch || globalThis.fetch
    const c = this.consulta()
    const url =
      this.endpoint +
      '?producto=' + encodeURIComponent(c.producto) +
      '&version=' + encodeURIComponent(c.version) +
      '&plataforma=' + encodeURIComponent(c.plataforma) +
      '&arquitectura=' + encodeURIComponent(c.arquitectura) +
      '&canal=' + encodeURIComponent(c.canal)
    let res
    try {
      res = await traer(url)
    } catch (err) {
      // Sin internet no es un error que deba molestar a nadie: la app sigue
      // funcionando y se vuelve a preguntar la próxima vez.
      return { hayActualizacion: false, motivo: 'No se pudo consultar el sistema de actualizaciones' }
    }
    if (!res.ok) return { hayActualizacion: false, motivo: `El sistema respondió ${res.status}` }
    const datos = await res.json()

    // El servidor ya aplicó las reglas, pero el cliente las vuelve a aplicar
    // sobre lo que recibió: si algo respondiera de más (un canal que no pediste,
    // otra plataforma, una versión igual o menor), acá se descarta igual.
    if (!datos || !datos.hayActualizacion || !datos.release) {
      return { hayActualizacion: false, motivo: (datos && datos.motivo) || 'Ya estás en la última versión' }
    }
    return nucleo.decidirActualizacion(c, [datos.release])
  }

  /** Descarga y verifica. Devuelve la ruta del archivo listo para aplicar. */
  descargar(release, alProgresar) {
    return integridad.descargarVerificado(release, this.carpetaTrabajo, alProgresar, this.deps)
  }

  /** Aplica lo ya descargado y verificado. */
  aplicar(release, rutaArchivo) {
    return aplicar.aplicar(
      release,
      rutaArchivo,
      { carpetaTrabajo: this.carpetaTrabajo, rutaAppImage: this.rutaAppImage, firmada: this.firmada },
      this.deps,
    )
  }

  /** Vuelve a la versión anterior (solo donde es técnicamente posible). */
  revertir() {
    if (this.plataforma !== 'linux' || !this.rutaAppImage) {
      return { revertido: false, motivo: 'En esta plataforma la recuperación la maneja el instalador del sistema' }
    }
    return aplicar.revertirAppImage(this.rutaAppImage, this.carpetaTrabajo)
  }
}

module.exports = { ClienteActualizacion, detectarEntorno, ENDPOINT_POR_DEFECTO, nucleo, integridad, aplicar }
