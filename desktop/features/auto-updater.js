// Auto-Updater: checks GitHub Releases for new versions, downloads and installs silently
// Uses electron-updater which works with electron-builder's publish config

const { autoUpdater } = require('electron-updater');
const { ipcMain, dialog } = require('electron');

let mainWindow;

function initAutoUpdater({ getMainWindow }) {
  mainWindow = getMainWindow;

  // Configure
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.allowDowngrade = false;

  // Don't show built-in dialogs
  autoUpdater.logger = require('electron').app.isPackaged ? null : console;

  // ── Events ──

  autoUpdater.on('checking-for-update', () => {
    sendStatus('checking', 'Checking for updates...');
  });

  autoUpdater.on('update-available', (info) => {
    sendStatus('available', `Update ${info.version} available. Downloading...`);
  });

  autoUpdater.on('update-not-available', () => {
    sendStatus('up-to-date', 'You are on the latest version.');
  });

  autoUpdater.on('download-progress', (progress) => {
    sendStatus('downloading', `Downloading: ${Math.round(progress.percent)}%`, {
      percent: progress.percent,
      bytesPerSecond: progress.bytesPerSecond,
      transferred: progress.transferred,
      total: progress.total,
    });
  });

  autoUpdater.on('update-downloaded', (info) => {
    sendStatus('ready', `Update ${info.version} ready. Will install on restart.`);

    // Show a non-intrusive notification in the app
    const win = mainWindow();
    if (win && !win.isDestroyed()) {
      win.webContents.send('update-ready', {
        version: info.version,
        releaseNotes: info.releaseNotes,
      });
    }
  });

  autoUpdater.on('error', (err) => {
    sendStatus('error', `Update error: ${err.message}`);
  });

  // ── IPC handlers ──

  // Manual check for updates
  ipcMain.on('check-for-updates', () => {
    autoUpdater.checkForUpdates().catch(() => {});
  });

  // Install update now (restart app)
  ipcMain.on('install-update', () => {
    autoUpdater.quitAndInstall(false, true);
  });

  // Get current update status
  ipcMain.handle('get-update-status', () => lastStatus);

  // ── Auto-check on launch (after 10 seconds) ──
  setTimeout(() => {
    autoUpdater.checkForUpdates().catch(() => {});
  }, 10000);

  // Check every 4 hours
  setInterval(() => {
    autoUpdater.checkForUpdates().catch(() => {});
  }, 4 * 60 * 60 * 1000);
}

let lastStatus = { state: 'idle', message: '' };

function sendStatus(state, message, data = {}) {
  lastStatus = { state, message, ...data };
  const win = mainWindow?.();
  if (win && !win.isDestroyed()) {
    win.webContents.send('update-status', lastStatus);
  }
}

module.exports = { initAutoUpdater };
