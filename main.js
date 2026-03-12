const { app, BrowserWindow, shell, ipcMain, dialog, globalShortcut, desktopCapturer } = require('electron');
const path = require('path');
const Store = require('electron-store');
const fs = require('fs');
const https = require('https');
const extractZip = require('extract-zip');
const { exec } = require('child_process');

const store = new Store();
let mainWindow = null;
let isGameRunning = false;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 720,
    minWidth: 1024,
    minHeight: 600,
    center: true,
    resizable: true,
    frame: false, 
    icon: path.join(__dirname, '512x512.png'),
    transparent: true,
    autoHideMenuBar: true,
    webPreferences: {
      nodeIntegration: true, 
      contextIsolation: false,
      enableRemoteModule: true
    }
  });

  mainWindow.loadFile('index.html');

  ipcMain.on('window-minimize', () => mainWindow.minimize());
  ipcMain.on('window-maximize', () => {
    if (mainWindow.isMaximized()) {
      mainWindow.unmaximize();
    } else {
      mainWindow.maximize();
    }
  });
  ipcMain.on('window-close', () => mainWindow.close());
  ipcMain.on('window-fullscreen', () => {
    mainWindow.setFullScreen(!mainWindow.isFullScreen());
  });
  ipcMain.on('window-set-fullscreen', (event, enabled) => {
    mainWindow.setFullScreen(Boolean(enabled));
  });

  ipcMain.handle('take-screenshot', async (event) => {
    try {
      const screenshotsDir = path.join(app.getPath('userData'), 'Screenshots');
      if (!fs.existsSync(screenshotsDir)) {
        fs.mkdirSync(screenshotsDir, { recursive: true });
      }
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const fileName = `screenshot-${timestamp}.png`;
      const filePath = path.join(screenshotsDir, fileName);

      if (isGameRunning) {
        const sources = await desktopCapturer.getSources({ 
          types: ['window', 'screen'], 
          thumbnailSize: { width: 3840, height: 2160 } // High res for screenshot
        });
        
        // Find Minecraft window or fallback to primary screen
        const source = sources.find(s => s.name.toLowerCase().includes('minecraft')) || 
                       sources.find(s => s.id.startsWith('screen'));
        
        if (source) {
          fs.writeFileSync(filePath, source.thumbnail.toPNG());
          return filePath;
        }
      }

      // Fallback to launcher capture if game isn't running or not found
      const win = BrowserWindow.fromWebContents(event.sender) || mainWindow;
      if (!win) throw new Error("Window not found");
      const image = await win.capturePage();
      fs.writeFileSync(filePath, image.toPNG());
      return filePath;
    } catch (err) {
      console.error("Screenshot capture error:", err);
      throw err;
    }
  });

  ipcMain.on('game-running-state', (event, running) => {
    isGameRunning = running;
    if (running) {
      globalShortcut.register('F2', () => {
        if (mainWindow) {
          mainWindow.webContents.send('trigger-screenshot');
        }
      });
    } else {
      globalShortcut.unregister('F2');
    }
  });

  ipcMain.handle('list-screenshots', async () => {
    const screenshotsDir = path.join(app.getPath('userData'), 'Screenshots');
    if (!fs.existsSync(screenshotsDir)) {
      return [];
    }
    const files = fs.readdirSync(screenshotsDir);
    return files
      .filter(f => f.toLowerCase().endsWith('.png'))
      .sort((a, b) => {
        try {
          // Extract timestamp from 'screenshot-YYYY-MM-DDTHH-mm-ss-SSSZ.png'
          const timeA = a.replace('screenshot-', '').replace('.png', '').replace(/-/g, ':');
          const timeB = b.replace('screenshot-', '').replace('.png', '').replace(/-/g, ':');
          return new Date(timeB) - new Date(timeA);
        } catch (e) {
          return 0;
        }
      })
      .map(f => ({
        name: f,
        path: path.join(screenshotsDir, f),
        url: `file://${path.join(screenshotsDir, f)}`
      }));
  });

  ipcMain.handle('delete-screenshot', async (event, fileName) => {
    const filePath = path.join(app.getPath('userData'), 'Screenshots', fileName);
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
      return true;
    }
    return false;
  });

  ipcMain.handle('open-screenshots-dir', async () => {
    const screenshotsDir = path.join(app.getPath('userData'), 'Screenshots');
    if (!fs.existsSync(screenshotsDir)) {
      fs.mkdirSync(screenshotsDir, { recursive: true });
    }
    shell.openPath(screenshotsDir);
  });

  ipcMain.handle('store-get', (event, key) => store.get(key));
  ipcMain.handle('store-set', (event, key, value) => store.set(key, value));
  
  ipcMain.handle('select-directory', async () => {
    const result = await dialog.showOpenDialog({
      properties: ['openDirectory', 'createDirectory']
    });
    return result.filePaths[0];
  });
 
  mainWindow.on('maximize', () => mainWindow.webContents.send('window-is-maximized', true));
  mainWindow.on('unmaximize', () => mainWindow.webContents.send('window-is-maximized', false));

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });
}

app.whenReady().then(() => {
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
