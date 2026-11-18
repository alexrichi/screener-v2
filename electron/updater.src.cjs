const { autoUpdater } = require('electron-updater');
const { dialog } = require('electron');

const START_DELAY = 10_000;
const CHECK_INTERVAL = 4 * 60 * 60 * 1000;

/**
 * Wires the packaged app to the public GitHub releases. The updater downloads
 * in the background and asks before restarting: scan results and alerts are
 * session-only, so a silent restart would lose them.
 */
function initUpdater(mainWindow) {
  let checking = false;

  const check = async () => {
    if (checking) return;
    checking = true;
    try {
      await autoUpdater.checkForUpdates();
    } catch (error) {
      console.error('[updater] check failed:', error instanceof Error ? error.message : error);
    } finally {
      checking = false;
    }
  };

  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on('error', (error) => {
    console.error('[updater]', error instanceof Error ? error.message : error);
  });

  autoUpdater.on('update-downloaded', async (info) => {
    const options = {
      type: 'info',
      buttons: ['Restart and update', 'Later'],
      defaultId: 0,
      cancelId: 1,
      title: 'Update ready',
      message: `Screener ${info.version} is ready to install.`,
      detail: 'Restarting closes the app. Scan results and session alerts will be lost.',
    };
    const { response } = mainWindow
      ? await dialog.showMessageBox(mainWindow, options)
      : await dialog.showMessageBox(options);
    if (response === 0) autoUpdater.quitAndInstall();
  });

  setTimeout(check, START_DELAY);
  setInterval(check, CHECK_INTERVAL);
}

module.exports = { initUpdater };
