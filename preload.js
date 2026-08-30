'use strict'

const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('djia', {
  searchYoutube: (query, opts) => ipcRenderer.invoke('djia:search', { query, safe: !!(opts && opts.safe) }),
  checkYoutubeVideo: (id) => ipcRenderer.invoke('djia:check', { id }),
  checkForUpdate: () => ipcRenderer.invoke('djia:checkForUpdate'),
  platform: process.platform,
  // Separación real de stems (IA, HT-Demucs vía onnxruntime-node) — corre
  // en el proceso main (en un worker thread aparte, ver `stemWorker.js`),
  // nunca en el renderer. `onStemsProgress` avisa mientras separa (puede
  // tardar unos minutos la primera vez); `separateStems` devuelve el
  // resultado final.
  separateStems: (payload) => ipcRenderer.invoke('djia:separateStems', payload),
  onStemsProgress: (cb) => {
    const listener = (_evt, data) => cb(data)
    ipcRenderer.on('djia:stemsProgress', listener)
    return () => ipcRenderer.removeListener('djia:stemsProgress', listener)
  },
})
