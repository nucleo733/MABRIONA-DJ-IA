'use strict'

const { contextBridge, ipcRenderer } = require('electron')

/**
 * Puente real y mínimo hacia el proceso principal — solo expone la
 * búsqueda/selección real vía MABRIONA Browser (integración oficial),
 * nunca acceso directo a Node/red desde la página cargada
 * (`mabriona.com/dj-ia-app`, contextIsolation real, sandbox real).
 */
contextBridge.exposeInMainWorld('mabrionaDesktop', {
  isDesktop: true,
  pickYoutubeVideo: (query) => ipcRenderer.invoke('mabriona-browser:pick', query),
})
