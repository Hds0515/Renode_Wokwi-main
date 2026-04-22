const { app, BrowserWindow, dialog, ipcMain } = require('electron');
const fs = require('fs');
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

const PROJECT_FILE_EXTENSION = '.renode-wokwi.json';
const PROJECT_FILE_FILTERS = [
  { name: 'Renode Wokwi Project (*.renode-wokwi.json)', extensions: ['json'] },
  { name: 'JSON', extensions: ['json'] },
];

function ensureProjectFileExtension(filePath) {
  if (filePath.endsWith(PROJECT_FILE_EXTENSION) || filePath.endsWith('.json')) {
    return filePath;
  }
  return `${filePath}${PROJECT_FILE_EXTENSION}`;
}

function formatError(error) {
  return error instanceof Error ? error.message : String(error);
}

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
ipcMain.handle('local-wokwi:send-uart-data', async (_event, request) => runtime.sendUartData(request));
ipcMain.handle('local-wokwi:start-debugging', async (_event, request) => runtime.startDebugging(request));
ipcMain.handle('local-wokwi:stop-debugging', async () => runtime.stopDebugging());
ipcMain.handle('local-wokwi:debug-action', async (_event, request) => runtime.debugAction(request));
ipcMain.handle('local-wokwi:save-project', async (_event, request = {}) => {
  try {
    if (!request.project || typeof request.project !== 'object') {
      return {
        success: false,
        message: 'Project payload is missing.',
      };
    }

    let filePath = request.filePath;
    if (!filePath || request.saveAs) {
      const result = await dialog.showSaveDialog(runtimeWindow, {
        title: 'Save Renode Wokwi Project',
        defaultPath: filePath || 'Renode_Wokwi_Project.renode-wokwi.json',
        filters: PROJECT_FILE_FILTERS,
      });

      if (result.canceled || !result.filePath) {
        return {
          success: false,
          canceled: true,
          message: 'Save canceled.',
        };
      }

      filePath = result.filePath;
    }

    const targetPath = ensureProjectFileExtension(filePath);
    await fs.promises.mkdir(path.dirname(targetPath), { recursive: true });
    await fs.promises.writeFile(targetPath, `${JSON.stringify(request.project, null, 2)}\n`, 'utf8');

    return {
      success: true,
      message: `Project saved: ${targetPath}`,
      filePath: targetPath,
    };
  } catch (error) {
    return {
      success: false,
      message: `Project save failed: ${formatError(error)}`,
    };
  }
});

ipcMain.handle('local-wokwi:load-project', async (_event, request = {}) => {
  try {
    let filePath = request.filePath;
    if (!filePath) {
      const result = await dialog.showOpenDialog(runtimeWindow, {
        title: 'Load Renode Wokwi Project',
        properties: ['openFile'],
        filters: PROJECT_FILE_FILTERS,
      });

      if (result.canceled || result.filePaths.length === 0) {
        return {
          success: false,
          canceled: true,
          message: 'Load canceled.',
        };
      }

      filePath = result.filePaths[0];
    }

    const content = await fs.promises.readFile(filePath, 'utf8');
    const project = JSON.parse(content);

    return {
      success: true,
      message: `Project loaded: ${filePath}`,
      filePath,
      project,
    };
  } catch (error) {
    return {
      success: false,
      message: `Project load failed: ${formatError(error)}`,
    };
  }
});

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
