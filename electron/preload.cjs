const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('localWokwi', {
  getTooling: () => ipcRenderer.invoke('local-wokwi:get-tooling'),
  compileFirmware: (request) => ipcRenderer.invoke('local-wokwi:compile', request),
  startSimulation: (request) => ipcRenderer.invoke('local-wokwi:start-simulation', request),
  stopSimulation: () => ipcRenderer.invoke('local-wokwi:stop-simulation'),
  sendPeripheralEvent: (request) => ipcRenderer.invoke('local-wokwi:send-peripheral-event', request),
  startDebugging: (request) => ipcRenderer.invoke('local-wokwi:start-debugging', request),
  stopDebugging: () => ipcRenderer.invoke('local-wokwi:stop-debugging'),
  debugAction: (request) => ipcRenderer.invoke('local-wokwi:debug-action', request),
  onSimulationEvent: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on('local-wokwi:event', listener);
    return () => {
      ipcRenderer.removeListener('local-wokwi:event', listener);
    };
  },
});
