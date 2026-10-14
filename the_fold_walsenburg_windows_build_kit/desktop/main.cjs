const { app, BrowserWindow, Menu } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const { pathToFileURL } = require('node:url');

app.setName('The Fold - Walsenburg');
const saveDirectory = path.join(app.getPath('appData'), 'The Fold - Walsenburg');
fs.mkdirSync(saveDirectory, { recursive: true });
app.setPath('userData', saveDirectory);

if (!app.requestSingleInstanceLock()) app.quit();
else {
  let window;
  const createWindow = () => {
    window = new BrowserWindow({
      width: 1440, height: 900, minWidth: 800, minHeight: 600,
      title: 'The Fold / Walsenburg', backgroundColor: '#101813',
      autoHideMenuBar: true, show: false,
      icon: path.join(__dirname, 'build', 'icon.png'),
      webPreferences: { contextIsolation: true, sandbox: true, nodeIntegration: false, webSecurity: true, spellcheck: false },
    });
    Menu.setApplicationMenu(null);
    const entry = path.join(__dirname, 'game', 'index.html');
    const entryUrl = pathToFileURL(entry).href;
    window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    window.webContents.on('will-navigate', (event, url) => {
      if (url.split('#')[0] !== entryUrl) event.preventDefault();
    });
    window.webContents.session.setPermissionRequestHandler((_contents, permission, callback) => {
      callback(['pointerLock', 'fullscreen'].includes(permission));
    });
    window.once('ready-to-show', () => window.show());
    window.loadFile(entry);
    window.webContents.on('before-input-event', (event, input) => {
      if (input.type === 'keyDown' && input.key === 'F11') { event.preventDefault(); window.setFullScreen(!window.isFullScreen()); }
    });
  };
  app.on('second-instance', () => { if (window) { if (window.isMinimized()) window.restore(); window.focus(); } });
  app.whenReady().then(createWindow);
  app.on('window-all-closed', () => app.quit());
}