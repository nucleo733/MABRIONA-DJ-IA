'use strict'

/**
 * MABRIONA UPDATE SYSTEM — aplicación de la actualización por plataforma
 * (FASES 7, 10, 11, 12, 15).
 *
 * Cada sistema operativo tiene una única forma correcta de recibir una versión
 * nueva, y ninguna es "reemplazar archivos a mano mientras la app corre".
 *
 *   Linux (AppImage): la app ES un archivo. Se reemplaza ese archivo por el
 *     nuevo, guardando el anterior al lado. Es la única plataforma donde el
 *     rollback es completo y automático, porque volver atrás es restaurar un
 *     archivo.
 *
 *   Windows (NSIS): se ejecuta el instalador descargado. Instala sobre la
 *     versión anterior y la app se cierra para dejarlo trabajar. El propio
 *     instalador de NSIS mantiene el desinstalador de la versión previa, así
 *     que la recuperación existe aunque no la manejemos nosotros.
 *
 *   macOS: sin certificado Developer ID, el sistema NO permite que una app
 *     sin firmar se reemplace a sí misma en silencio (Squirrel.Mac exige
 *     firma). Entonces no se simula: se abre el DMG ya descargado y verificado
 *     y se le dice al usuario, en una frase, que arrastre la app. Es un paso
 *     manual honesto, no un auto-update de mentira. En cuanto exista el
 *     certificado, esta rama pasa a `quitAndInstall` sin tocar nada más del
 *     sistema — por eso vive aislada acá.
 */

const fs = require('node:fs')
const path = require('node:path')
const { spawn, execFile } = require('node:child_process')

/** Carpeta donde se guarda la versión anterior antes de pisarla (FASE 15). */
function carpetaRespaldo(carpetaTrabajo) {
  return path.join(carpetaTrabajo, 'version-anterior')
}

/**
 * Linux: reemplaza el AppImage en marcha, guardando el anterior.
 * Devuelve { aplicado, requiereReinicio, respaldo }.
 */
function aplicarAppImage(rutaNueva, rutaActual, carpetaTrabajo) {
  if (!rutaActual || !fs.existsSync(rutaActual)) {
    throw new Error('No se encontró el AppImage en ejecución: no se toca nada')
  }
  const respaldoDir = carpetaRespaldo(carpetaTrabajo)
  fs.mkdirSync(respaldoDir, { recursive: true })
  const respaldo = path.join(respaldoDir, path.basename(rutaActual))
  if (fs.existsSync(respaldo)) fs.unlinkSync(respaldo)

  // Primero se guarda la versión vieja, después se copia la nueva. Si la copia
  // falla a mitad, el respaldo ya existe y `revertirAppImage` puede rehacerlo.
  fs.copyFileSync(rutaActual, respaldo)
  try {
    fs.copyFileSync(rutaNueva, rutaActual)
    fs.chmodSync(rutaActual, 0o755)
  } catch (err) {
    fs.copyFileSync(respaldo, rutaActual)
    fs.chmodSync(rutaActual, 0o755)
    throw new Error('No se pudo aplicar la actualización; se restauró la versión anterior. ' + err.message)
  }
  return { aplicado: true, requiereReinicio: true, respaldo }
}

/** Deshace lo anterior: vuelve a poner la versión guardada. */
function revertirAppImage(rutaActual, carpetaTrabajo) {
  const respaldo = path.join(carpetaRespaldo(carpetaTrabajo), path.basename(rutaActual))
  if (!fs.existsSync(respaldo)) return { revertido: false, motivo: 'No hay versión anterior guardada' }
  fs.copyFileSync(respaldo, rutaActual)
  fs.chmodSync(rutaActual, 0o755)
  return { revertido: true }
}

/** Windows: lanza el instalador NSIS ya verificado y se desentiende. */
function aplicarInstaladorWindows(rutaInstalador, deps = {}) {
  const lanzar = deps.spawn || spawn
  const hijo = lanzar(rutaInstalador, [], { detached: true, stdio: 'ignore' })
  hijo.unref()
  return { aplicado: true, requiereCierre: true }
}

/** macOS sin firma: abre el DMG verificado para que la persona arrastre la app. */
function abrirDmgMac(rutaDmg, deps = {}) {
  const abrir = deps.execFile || execFile
  abrir('open', [rutaDmg], () => {})
  return { aplicado: false, requiereArrastre: true }
}

/**
 * Punto único de entrada: elige la vía correcta según la plataforma y nunca
 * mezcla (FASE 20: jamás un instalador de un sistema en otro).
 */
function aplicar(release, rutaArchivo, contexto, deps = {}) {
  if (release.plataforma === 'linux') {
    return aplicarAppImage(rutaArchivo, contexto.rutaAppImage, contexto.carpetaTrabajo)
  }
  if (release.plataforma === 'windows') {
    return aplicarInstaladorWindows(rutaArchivo, deps)
  }
  if (release.plataforma === 'macos') {
    if (contexto.firmada) {
      // Reservado para cuando exista el certificado Developer ID: ahí manda
      // electron-updater, que es el único camino soportado por Apple.
      return { aplicado: false, delegarAElectronUpdater: true }
    }
    return abrirDmgMac(rutaArchivo, deps)
  }
  throw new Error(`Plataforma no soportada: ${release.plataforma}`)
}

module.exports = { aplicar, aplicarAppImage, revertirAppImage, aplicarInstaladorWindows, abrirDmgMac, carpetaRespaldo }
