'use strict'

/**
 * Puente mínimo entre la ventana de actualización y el proceso principal.
 *
 * La ventana no tiene Node ni acceso al sistema: solo puede decir "actualizar
 * ahora" o "más tarde", y recibir el progreso. Todo lo que toca archivos —
 * descargar, verificar el hash, instalar — vive del otro lado.
 */

const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('mabrionaUpdate', {
  ahora: () => ipcRenderer.send('mabriona-update:ahora'),
  luego: () => ipcRenderer.send('mabriona-update:luego'),
  alProgresar: (cb) => ipcRenderer.on('mabriona-update:progreso', (_e, datos) => cb(datos)),
  alEstado: (cb) => ipcRenderer.on('mabriona-update:estado', (_e, texto) => cb(texto)),
})
