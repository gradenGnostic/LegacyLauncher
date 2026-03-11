const { app, BrowserWindow, shell, ipcMain, dialog } = require('electron');
const path = require('path');
const Store = require('electron-store');
const fs = require('fs');
const https = require('https');
const extractZip = require('extract-zip');
const { exec } = require('child_process');

const store = new Store();

function createWindow() {
  const win = new BrowserWindow({
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

  win.loadFile('index.html');

  ipcMain.on('window-minimize', () => win.minimize());
  ipcMain.on('window-maximize', () => {
    if (win.isMaximized()) {
      win.unmaximize();
    } else {
      win.maximize();
    }
  });
  ipcMain.on('window-close', () => win.close());
  ipcMain.on('window-fullscreen', () => {
    win.setFullScreen(!win.isFullScreen());
  });
  ipcMain.on('window-set-fullscreen', (event, enabled) => {
    win.setFullScreen(Boolean(enabled));
  });

  ipcMain.handle('store-get', (event, key) => store.get(key));
  ipcMain.handle('store-set', (event, key, value) => store.set(key, value));
  
  ipcMain.handle('select-directory', async () => {
    const result = await dialog.showOpenDialog({
      properties: ['openDirectory', 'createDirectory']
    });
    return result.filePaths[0];
  });
 
  win.on('maximize', () => win.webContents.send('window-is-maximized', true));
  win.on('unmaximize', () => win.webContents.send('window-is-maximized', false));

  win.webContents.setWindowOpenHandler(({ url }) => {
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
