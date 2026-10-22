const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('asistente', { instalar: (datos) => ipcRenderer.invoke('instalar', datos) });
