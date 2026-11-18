const { contextBridge, ipcRenderer } = require('electron');

const buildBuilt = (() => {
  try {
    return ipcRenderer.sendSync('screener:build-built') ?? null;
  } catch {
    return null;
  }
})();

contextBridge.exposeInMainWorld('screenerWindow', {
  setTitleBarTheme: (theme) =>
    ipcRenderer.send('screener:titlebar-theme', theme === 'light' ? 'light' : 'dark'),
  minimize: () => ipcRenderer.send('screener:window', 'minimize'),
  toggleMaximize: () => ipcRenderer.send('screener:window', 'toggle-maximize'),
  close: () => ipcRenderer.send('screener:window', 'close'),
  quit: () => ipcRenderer.send('screener:window', 'quit'),
  pickScript: () => ipcRenderer.invoke('screener:pick-script'),
  openExternal: (url) => ipcRenderer.send('screener:open-external', url),
  buildBuilt,
});
