'use strict'

/**
 * MABRIONA UPDATE SYSTEM — descarga verificada (FASES 7 y 9).
 *
 * Regla que no se negocia: un archivo descargado NO es una actualización hasta
 * que su SHA-256 coincide con el del manifiesto. Si no coincide, se borra en el
 * acto — no se guarda "por si acaso", porque un archivo corrupto o manipulado
 * guardado en disco es exactamente lo que un atacante necesita que pase.
 */

const fs = require('node:fs')
const crypto = require('node:crypto')
const path = require('node:path')

/** SHA-256 de un archivo, leído por partes para no cargar 100 MB en memoria. */
function hashDeArchivo(ruta) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256')
    const flujo = fs.createReadStream(ruta)
    flujo.on('error', reject)
    flujo.on('data', (trozo) => hash.update(trozo))
    flujo.on('end', () => resolve('sha256:' + hash.digest('hex')))
  })
}

/**
 * Compara dos hashes en tiempo constante. Con `===` el tiempo de comparación
 * delata cuántos caracteres iniciales acertaste, que es por donde se ataca una
 * verificación de integridad.
 */
function hashesIguales(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false
  const ba = Buffer.from(a)
  const bb = Buffer.from(b)
  if (ba.length !== bb.length) return false
  return crypto.timingSafeEqual(ba, bb)
}

/**
 * Descarga un release y lo verifica. Devuelve la ruta del archivo solo si pasó
 * la verificación; si no, lanza y no deja nada en disco.
 *
 * @param {object} release entrada del manifiesto (url, hash, tamano, archivo)
 * @param {string} carpetaDestino dónde dejar el archivo
 * @param {(descargado:number, total:number)=>void} [alProgresar]
 * @param {object} [deps] inyección para pruebas (fetch propio)
 */
async function descargarVerificado(release, carpetaDestino, alProgresar, deps = {}) {
  const traer = deps.fetch || globalThis.fetch
  const { urlAceptable } = require('./nucleo')
  if (!urlAceptable(release.url)) {
    throw new Error('La actualización no viaja por HTTPS: se rechaza')
  }
  fs.mkdirSync(carpetaDestino, { recursive: true })
  // `.parcial` mientras baja: así un corte a mitad nunca deja un archivo con
  // nombre de instalador válido que alguien (o el propio sistema) pueda abrir.
  const destino = path.join(carpetaDestino, release.archivo)
  const parcial = destino + '.parcial'
  if (fs.existsSync(parcial)) fs.unlinkSync(parcial)

  const res = await traer(release.url, { redirect: 'follow' })
  if (!res.ok) throw new Error(`La descarga respondió ${res.status}`)

  const total = Number(res.headers.get('content-length')) || release.tamano || 0
  let descargado = 0
  const salida = fs.createWriteStream(parcial)

  for await (const trozo of res.body) {
    salida.write(Buffer.from(trozo))
    descargado += trozo.length
    if (alProgresar) alProgresar(descargado, total)
  }
  await new Promise((resolve, reject) => {
    salida.end((err) => (err ? reject(err) : resolve()))
  })

  if (release.tamano && fs.statSync(parcial).size !== release.tamano) {
    fs.unlinkSync(parcial)
    throw new Error('El archivo descargado no tiene el tamaño declarado: se descarta')
  }

  const real = await hashDeArchivo(parcial)
  if (!hashesIguales(real, release.hash)) {
    fs.unlinkSync(parcial)
    throw new Error('La verificación de integridad falló: el archivo no es el publicado. Se descartó.')
  }

  if (fs.existsSync(destino)) fs.unlinkSync(destino)
  fs.renameSync(parcial, destino)
  return destino
}

module.exports = { hashDeArchivo, hashesIguales, descargarVerificado }
