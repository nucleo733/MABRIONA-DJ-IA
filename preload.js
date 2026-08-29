'use strict'

const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('djia', {
  searchYoutube: (query, opts) => ipcRenderer.invoke('djia:search', { query, safe: !!(opts && opts.safe) }),
  checkYoutubeVideo: (id) => ipcRenderer.invoke('djia:check', { id }),
})
