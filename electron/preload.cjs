const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('screenerWindow', {
  setTitleBarTheme: (theme) =>
    ipcRenderer.send('screener:titlebar-theme', theme === 'light' ? 'light' : 'dark'),
  minimize: () => ipcRenderer.send('screener:window', 'minimize'),
  toggleMaximize: () => ipcRenderer.send('screener:window', 'toggle-maximize'),
  close: () => ipcRenderer.send('screener:window', 'close'),
  quit: () => ipcRenderer.send('screener:window', 'quit'),
});
