'use strict';
// Ponte entre a interface (renderer) e o processo principal.
// A interface não tem acesso ao Node; só enxerga estas quatro funções.

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('deck', {
  getState: () => ipcRenderer.invoke('state:get'),
  action: (type, payload) => ipcRenderer.invoke('action', type, payload),
  onState: (handler) => ipcRenderer.on('state', (_event, state) => handler(state)),
  onMetrics: (handler) => ipcRenderer.on('metrics', (_event, metrics) => handler(metrics)),
  onCommand: (handler) => ipcRenderer.on('command', (_event, command) => handler(command)),
});
