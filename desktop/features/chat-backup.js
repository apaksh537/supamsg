// Chat Backup & Cloud Sync: backup conversations, templates, labels, settings
// Supports auto-backup, export/import, and restore

const path = require('path');
const fs = require('fs');
const { dialog } = require('electron');

let userDataPath;
let backupsDir;
let configPath;
let backupConfig = { enabled: false, intervalHours: 24 };
let autoBackupTimer = null;
let appRef = null;

function initChatBackup({ app, ipcMain, getMainWindow }) {
  appRef = app;
  userDataPath = app.getPath('userData');
  backupsDir = path.join(userDataPath, 'backups');
  configPath = path.join(userDataPath, 'backup-config.json');

  // Ensure backups directory exists
  if (!fs.existsSync(backupsDir)) {
    fs.mkdirSync(backupsDir, { recursive: true });
  }

  loadConfig();
  startAutoBackupIfEnabled();

  ipcMain.handle('create-backup', async () => {
    return createBackup();
  });

  ipcMain.handle('get-backups', () => {
    return listBackups();
  });

  ipcMain.handle('restore-backup', (_event, { backupPath }) => {
    return restoreBackup(backupPath);
  });

  ipcMain.on('delete-backup', (_event, { backupPath }) => {
    try {
      if (fs.existsSync(backupPath)) {
        fs.unlinkSync(backupPath);
      }
      const win = getMainWindow();
      if (win && !win.isDestroyed()) {
        win.webContents.send('backups-updated', listBackups());
      }
    } catch (err) {
      console.error('[chat-backup] Failed to delete backup:', err.message);
    }
  });

  ipcMain.on('export-backup', async (_event, { backupPath }) => {
    try {
      const win = getMainWindow();
      const result = await dialog.showSaveDialog(win, {
        title: 'Export Backup',
        defaultPath: path.basename(backupPath),
        filters: [{ name: 'JSON Files', extensions: ['json'] }],
      });
      if (!result.canceled && result.filePath) {
        fs.copyFileSync(backupPath, result.filePath);
      }
    } catch (err) {
      console.error('[chat-backup] Failed to export backup:', err.message);
    }
  });

  ipcMain.on('import-backup', async () => {
    try {
      const win = getMainWindow();
      const result = await dialog.showOpenDialog(win, {
        title: 'Import Backup',
        filters: [{ name: 'JSON Files', extensions: ['json'] }],
        properties: ['openFile'],
      });
      if (!result.canceled && result.filePaths.length > 0) {
        const srcPath = result.filePaths[0];
        const destName = `imported-${Date.now()}.json`;
        const destPath = path.join(backupsDir, destName);
        fs.copyFileSync(srcPath, destPath);
        if (win && !win.isDestroyed()) {
          win.webContents.send('backups-updated', listBackups());
          win.webContents.send('backup-imported', { path: destPath, name: destName });
        }
      }
    } catch (err) {
      console.error('[chat-backup] Failed to import backup:', err.message);
    }
  });

  ipcMain.on('set-auto-backup', (_event, { enabled, intervalHours }) => {
    backupConfig.enabled = enabled;
    backupConfig.intervalHours = intervalHours || 24;
    saveConfig();
    startAutoBackupIfEnabled();
  });
}

function loadConfig() {
  try {
    if (fs.existsSync(configPath)) {
      backupConfig = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    }
  } catch (err) {
    console.error('[chat-backup] Failed to load config:', err.message);
  }
}

function saveConfig() {
  try {
    fs.writeFileSync(configPath, JSON.stringify(backupConfig, null, 2));
  } catch (err) {
    console.error('[chat-backup] Failed to save config:', err.message);
  }
}

function startAutoBackupIfEnabled() {
  if (autoBackupTimer) {
    clearInterval(autoBackupTimer);
    autoBackupTimer = null;
  }
  if (backupConfig.enabled && backupConfig.intervalHours > 0) {
    const intervalMs = backupConfig.intervalHours * 60 * 60 * 1000;
    autoBackupTimer = setInterval(() => {
      createBackup();
      pruneOldBackups(10);
    }, intervalMs);
  }
}

function createBackup() {
  try {
    const files = fs.readdirSync(userDataPath).filter((f) => f.endsWith('.json'));
    const bundle = {
      _meta: {
        version: '1.0',
        date: new Date().toISOString(),
        accountCount: 0,
      },
      files: {},
    };

    let accountCount = 0;
    for (const fileName of files) {
      const filePath = path.join(userDataPath, fileName);
      try {
        const stat = fs.statSync(filePath);
        if (!stat.isFile()) continue;
        const content = fs.readFileSync(filePath, 'utf-8');
        bundle.files[fileName] = content;
        if (fileName === 'accounts.json') {
          try {
            const accounts = JSON.parse(content);
            accountCount = Array.isArray(accounts) ? accounts.length : 0;
          } catch (_) { /* ignore */ }
        }
      } catch (_) { /* skip unreadable files */ }
    }

    bundle._meta.accountCount = accountCount;

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupName = `backup-${timestamp}.json`;
    const backupPath = path.join(backupsDir, backupName);
    fs.writeFileSync(backupPath, JSON.stringify(bundle, null, 2));

    const stat = fs.statSync(backupPath);
    return {
      path: backupPath,
      name: backupName,
      date: bundle._meta.date,
      size: stat.size,
      fileCount: Object.keys(bundle.files).length,
      accountCount,
    };
  } catch (err) {
    console.error('[chat-backup] Failed to create backup:', err.message);
    return { error: err.message };
  }
}

function listBackups() {
  try {
    if (!fs.existsSync(backupsDir)) return [];
    const files = fs.readdirSync(backupsDir).filter((f) => f.endsWith('.json'));
    return files.map((f) => {
      const fullPath = path.join(backupsDir, f);
      const stat = fs.statSync(fullPath);
      return {
        path: fullPath,
        name: f,
        date: stat.mtime.toISOString(),
        size: stat.size,
      };
    }).sort((a, b) => new Date(b.date) - new Date(a.date));
  } catch (err) {
    console.error('[chat-backup] Failed to list backups:', err.message);
    return [];
  }
}

function restoreBackup(backupPath) {
  try {
    const raw = fs.readFileSync(backupPath, 'utf-8');
    const bundle = JSON.parse(raw);
    if (!bundle.files) {
      return { restored: false, error: 'Invalid backup format' };
    }

    let count = 0;
    for (const [fileName, content] of Object.entries(bundle.files)) {
      const destPath = path.join(userDataPath, fileName);
      fs.writeFileSync(destPath, content);
      count++;
    }

    return { restored: true, files: count };
  } catch (err) {
    console.error('[chat-backup] Failed to restore backup:', err.message);
    return { restored: false, error: err.message };
  }
}

function pruneOldBackups(keepCount) {
  try {
    const backups = listBackups();
    if (backups.length <= keepCount) return;
    const toDelete = backups.slice(keepCount);
    for (const backup of toDelete) {
      if (fs.existsSync(backup.path)) {
        fs.unlinkSync(backup.path);
      }
    }
  } catch (err) {
    console.error('[chat-backup] Failed to prune backups:', err.message);
  }
}

module.exports = { initChatBackup };
