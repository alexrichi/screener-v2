const { autoUpdater } = require('electron-updater');
const { dialog } = require('electron');

const START_DELAY = 10_000;
const CHECK_INTERVAL = 4 * 60 * 60 * 1000;

let availableVersion = null;
let prompting = false;

/**
 * The app never installs an update by itself. The title bar shows a button once
 * the download is ready; clicking it asks before restarting, because scan
 * results are session-only.
 */
async function installUpdate(mainWindow) {
  if (prompting) return;
  prompting = true;
  try {
    const options = {
      type: 'info',
      buttons: ['Restart and update', 'Later'],
      defaultId: 0,
      cancelId: 1,
      title: 'Update ready',
      message: availableVersion
        ? `Screener ${availableVersion} is ready to install.`
        : 'The update is ready to install.',
      detail: 'Restarting closes the app. Scan results will be lost.',
    };
    const { response } =
      mainWindow && !mainWindow.isDestroyed()
        ? await dialog.showMessageBox(mainWindow, options)
        : await dialog.showMessageBox(options);
    if (response === 0) autoUpdater.quitAndInstall();
  } catch (error) {
    console.error('[updater] install failed:', error);
  } finally {
    prompting = false;
  }
}

function initUpdater(mainWindow, onChange) {
  let checking = false;

  const publish = (status) => {
    try {
      onChange?.(status);
    } catch (error) {
      console.error('[updater] status failed:', error);
    }
  };

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
    publish({ state: 'error' });
  });

  autoUpdater.on('update-available', (info) => {
    availableVersion = info.version;
    publish({ state: 'available', version: info.version });
  });

  autoUpdater.on('update-not-available', () => {
    publish({ state: 'idle' });
  });

  autoUpdater.on('download-progress', (progress) => {
    publish({
      state: 'downloading',
      version: availableVersion ?? undefined,
      percent: Math.round(progress.percent),
    });
  });

  autoUpdater.on('update-downloaded', (info) => {
    availableVersion = info.version;
    publish({ state: 'downloaded', version: info.version });
  });

  setTimeout(check, START_DELAY);
  setInterval(check, CHECK_INTERVAL);
}

module.exports = { initUpdater, installUpdate };
