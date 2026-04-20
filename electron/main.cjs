const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const { createRuntimeService } = require('./runtime.cjs');

const APP_ROOT = path.resolve(__dirname, '..');
const runtime = createRuntimeService({
  onEvent(payload) {
    if (!runtimeWindow || runtimeWindow.isDestroyed()) {
      return;
    }
    runtimeWindow.webContents.send('local-wokwi:event', payload);
  },
});

let runtimeWindow = null;

function createWindow() {
  const preload = path.join(__dirname, 'preload.cjs');
  runtimeWindow = new BrowserWindow({
    width: 1520,
    height: 960,
    minWidth: 1180,
    minHeight: 760,
    backgroundColor: '#020617',
    webPreferences: {
      preload,
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  const devServerUrl = process.env.VITE_DEV_SERVER_URL;
  if (devServerUrl) {
    runtimeWindow.loadURL(devServerUrl);
  } else {
    runtimeWindow.loadFile(path.join(APP_ROOT, 'dist', 'index.html'));
  }
}

ipcMain.handle('local-wokwi:get-tooling', async () => runtime.getTooling());
ipcMain.handle('local-wokwi:compile', async (_event, request) => runtime.compileFirmware(request));
ipcMain.handle('local-wokwi:start-simulation', async (_event, request) => runtime.startSimulation(request));
ipcMain.handle('local-wokwi:stop-simulation', async () => runtime.stopSimulation());
ipcMain.handle('local-wokwi:send-peripheral-event', async (_event, request) => runtime.sendPeripheralEvent(request));
ipcMain.handle('local-wokwi:start-debugging', async (_event, request) => runtime.startDebugging(request));
ipcMain.handle('local-wokwi:stop-debugging', async () => runtime.stopDebugging());
ipcMain.handle('local-wokwi:debug-action', async (_event, request) => runtime.debugAction(request));

app.whenReady().then(createWindow);

app.on('window-all-closed', async () => {
  await runtime.stopSimulation();
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', async () => {
  await runtime.stopSimulation();
});
