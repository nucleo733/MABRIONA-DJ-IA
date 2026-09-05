'use strict'

/**
 * MABRIONA UPDATE SYSTEM — integración para aplicaciones Electron (FASE 6).
 *
 * Esto es lo único que una app tiene que llamar. Tres líneas en su `main.js`:
 *
 *   const { integrarActualizaciones } = require('./mabriona-update/electron')
 *   integrarActualizaciones({ producto: 'matoko-dj', version: app.getVersion() })
 *
 * La pantalla que ve la persona es la misma en Burbuja, MABRIONA Browser y
 * MATOKO DJ: cambia el nombre del producto y las versiones, nada más. Nadie
 * tiene que ir a una página web a bajar un instalador.
 */

const path = require('node:path')
const { ClienteActualizacion } = require('./index')

/** Ventana propia de actualización, con el aspecto del ecosistema. */
function ventanaActualizacion(electron, datos) {
  const { BrowserWindow } = electron
  const ventana = new BrowserWindow({
    width: 460,
    height: 340,
    resizable: false,
    minimizable: false,
    maximizable: false,
    title: datos.nombreProducto,
    backgroundColor: '#04050d',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(__dirname, 'preload-actualizacion.js'),
    },
  })
  ventana.setMenu?.(null)
  return ventana
}

function paginaHtml(datos) {
  const escapar = (t) => String(t == null ? '' : t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))
  return `<!doctype html><html lang="es"><head><meta charset="utf-8" />
<style>
  :root { color-scheme: dark; }
  body { margin:0; font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;
    background:radial-gradient(ellipse 70% 60% at 50% -10%,rgba(40,150,248,.20),#04050d 70%);
    color:#eaf2ff; display:flex; flex-direction:column; height:100vh; padding:26px 28px; box-sizing:border-box; }
  h1 { font-size:17px; margin:0 0 4px; }
  .producto { font-size:13px; font-weight:700; letter-spacing:.14em; text-transform:uppercase; color:#7ab6ff; margin-bottom:14px; }
  .versiones { font-size:13px; color:rgba(234,242,255,.6); line-height:1.9; }
  .versiones b { color:#eaf2ff; font-weight:600; }
  .notas { margin-top:12px; font-size:13px; line-height:1.5; color:rgba(234,242,255,.7); flex:1; overflow:auto; }
  .barra { height:6px; border-radius:99px; background:rgba(255,255,255,.12); overflow:hidden; display:none; margin:10px 0 4px; }
  .barra > i { display:block; height:100%; width:0; background:linear-gradient(90deg,#2896f8,#8b6cff); transition:width .2s; }
  .estado { font-size:12px; color:rgba(234,242,255,.55); min-height:16px; }
  .botones { display:flex; gap:10px; justify-content:flex-end; margin-top:14px; }
  button { font-family:inherit; font-size:13px; font-weight:700; padding:9px 20px; border-radius:99px; border:0; cursor:pointer; }
  #luego { background:transparent; color:rgba(234,242,255,.65); border:1px solid rgba(255,255,255,.18); }
  #ahora { background:linear-gradient(92deg,#2896f8,#8b6cff); color:#04050d; }
  button:disabled { opacity:.5; cursor:default; }
</style></head><body>
  <div class="producto">${escapar(datos.nombreProducto)}</div>
  <h1>Nueva actualización disponible</h1>
  <div class="versiones">
    Versión instalada: <b>${escapar(datos.versionInstalada)}</b><br />
    Nueva versión: <b>${escapar(datos.versionNueva)}</b>
  </div>
  <div class="notas">${escapar(datos.notas || 'Mejoras y correcciones.')}</div>
  <div class="barra" id="barra"><i id="progreso"></i></div>
  <div class="estado" id="estado"></div>
  <div class="botones">
    <button id="luego">Más tarde</button>
    <button id="ahora">Actualizar ahora</button>
  </div>
<script>
  const barra = document.getElementById('barra')
  const progreso = document.getElementById('progreso')
  const estado = document.getElementById('estado')
  const ahora = document.getElementById('ahora')
  const luego = document.getElementById('luego')

  luego.addEventListener('click', () => window.mabrionaUpdate.luego())
  ahora.addEventListener('click', () => {
    ahora.disabled = true
    luego.disabled = true
    barra.style.display = 'block'
    estado.textContent = 'Descargando…'
    window.mabrionaUpdate.ahora()
  })
  window.mabrionaUpdate.alProgresar(({ bajado, total }) => {
    const pct = total ? Math.round((bajado / total) * 100) : 0
    progreso.style.width = pct + '%'
    const mb = (n) => (n / 1048576).toFixed(1)
    estado.textContent = total
      ? 'Descargando ' + mb(bajado) + ' MB de ' + mb(total) + ' MB (' + pct + '%)'
      : 'Descargando ' + mb(bajado) + ' MB'
    if (pct >= 100) estado.textContent = 'Verificando la descarga…'
  })
  window.mabrionaUpdate.alEstado((t) => { estado.textContent = t })
</script>
</body></html>`
}

/**
 * Engancha el sistema de actualizaciones a una app Electron.
 *
 * @param {object} opciones producto, version, y opcionalmente canal/endpoint
 * @param {object} electron el módulo `electron` de la app (se pasa para que
 *   este archivo se pueda probar sin Electron instalado)
 */
function integrarActualizaciones(opciones, electron) {
  const el = electron || require('electron')
  const cliente = new ClienteActualizacion(opciones)
  const nombreProducto = opciones.nombreProducto || opciones.producto

  async function revisar({ silencioso = true } = {}) {
    const resultado = await cliente.revisar()
    if (!resultado.hayActualizacion) {
      if (!silencioso) {
        await el.dialog.showMessageBox({
          type: 'info',
          title: nombreProducto,
          message: 'Ya tenés la última versión.',
          detail: `Versión ${opciones.version}.`,
          buttons: ['Entendido'],
        })
      }
      return resultado
    }
    mostrar(resultado.release)
    return resultado
  }

  function mostrar(release) {
    const ventana = ventanaActualizacion(el, {
      nombreProducto,
      versionInstalada: opciones.version,
      versionNueva: release.version,
      notas: release.notas,
    })
    const html = paginaHtml({
      nombreProducto,
      versionInstalada: opciones.version,
      versionNueva: release.version,
      notas: release.notas,
    })
    ventana.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html))

    // La descarga y la instalación las decide el proceso principal; la ventana
    // solo informa. Así el renderer nunca toca archivos ni ejecuta nada.
    const alLuego = (evento) => {
      if (evento.sender !== ventana.webContents) return
      if (!ventana.isDestroyed()) ventana.close()
    }
    const alAhora = async (evento) => {
      if (evento.sender !== ventana.webContents) return
      try {
        const ruta = await cliente.descargar(release, (bajado, total) => {
          if (!ventana.isDestroyed()) ventana.webContents.send('mabriona-update:progreso', { bajado, total })
        })
        const res = cliente.aplicar(release, ruta)
        if (res.requiereReinicio || res.requiereCierre) {
          if (!ventana.isDestroyed()) ventana.close()
          el.app.relaunch?.()
          el.app.quit()
          return
        }
        if (res.requiereArrastre) {
          await el.dialog.showMessageBox({
            type: 'info',
            title: nombreProducto,
            message: 'La actualización se descargó y se verificó.',
            detail: 'Se abrió el disco de instalación: arrastrá la aplicación a la carpeta Aplicaciones para completar la actualización.',
            buttons: ['Entendido'],
          })
          if (!ventana.isDestroyed()) ventana.close()
        }
      } catch (err) {
        await el.dialog.showMessageBox({
          type: 'error',
          title: nombreProducto,
          message: 'No se pudo completar la actualización.',
          detail: String(err && err.message ? err.message : err) + '\n\nLa versión que ya tenías sigue intacta.',
          buttons: ['Entendido'],
        })
        if (!ventana.isDestroyed()) ventana.close()
      }
    }
    el.ipcMain.on('mabriona-update:luego', alLuego)
    el.ipcMain.on('mabriona-update:ahora', alAhora)
    // Sin esto, cada vez que se abriera la ventana quedaría un oyente más
    // escuchando por una ventana ya cerrada.
    ventana.on('closed', () => {
      el.ipcMain.removeListener('mabriona-update:luego', alLuego)
      el.ipcMain.removeListener('mabriona-update:ahora', alAhora)
    })
  }

  return { revisar, cliente }
}

module.exports = { integrarActualizaciones, paginaHtml }
