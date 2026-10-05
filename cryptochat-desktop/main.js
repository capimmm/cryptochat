const { app, BrowserWindow, session, shell } = require('electron');
const path = require('path');

function createWindow() {
  const win = new BrowserWindow({
    width: 1100,
    height: 800,
    minWidth: 400,
    minHeight: 620,
    backgroundColor: '#000000',
    autoHideMenuBar: true,
    title: 'CryptoChat',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      // necessário para WebRTC / getUserMedia
      webSecurity: true
    }
  });

  win.loadFile(path.join(__dirname, 'index.html'));

  // abrir links externos no navegador padrão
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http')) shell.openExternal(url);
    return { action: 'deny' };
  });
}

app.whenReady().then(() => {
  // Permissões: câmera, microfone, tela, clipboard
  session.defaultSession.setPermissionRequestHandler((wc, permission, callback) => {
    const ok = [
      'media',
      'display-capture',
      'clipboard-read',
      'clipboard-write',
      'notifications'
    ];
    callback(ok.includes(permission));
  });

  // Permissões síncronas (usado por alguns navegadores)
  session.defaultSession.setPermissionCheckHandler((wc, permission) => {
    const ok = [
      'media',
      'display-capture',
      'clipboard-read',
      'clipboard-write'
    ];
    return ok.includes(permission);
  });

  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
