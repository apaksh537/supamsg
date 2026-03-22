const fs = require('fs');
const path = require('path');
const { execFile, exec, spawn } = require('child_process');

function initScreenMirror({ app, ipcMain, getMainWindow, getViews, getActiveAccountId, getAccounts }) {
  const configPath = path.join(app.getPath('userData'), 'mirror-config.json');

  let config = { lastDeviceId: '' };
  let mirrorProcess = null;
  let mirrorDeviceId = null;

  // --- Persistence ---

  function loadConfig() {
    try {
      if (fs.existsSync(configPath)) {
        config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
      }
    } catch (err) {
      console.error('[screen-mirror] Failed to load config:', err);
    }
  }

  function saveConfig() {
    try {
      fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf-8');
    } catch (err) {
      console.error('[screen-mirror] Failed to save config:', err);
    }
  }

  // --- Helpers ---

  function runCommand(command, args) {
    return new Promise((resolve, reject) => {
      execFile(command, args, { timeout: 10000 }, (error, stdout, stderr) => {
        if (error) {
          reject(error);
        } else {
          resolve({ stdout: stdout.trim(), stderr: stderr.trim() });
        }
      });
    });
  }

  function parseAdbDevices(output) {
    const lines = output.split('\n').filter((l) => l.trim() && !l.startsWith('List of'));
    return lines.map((line) => {
      const parts = line.split('\t');
      return {
        id: parts[0] ? parts[0].trim() : '',
        status: parts[1] ? parts[1].trim() : 'unknown',
      };
    }).filter((d) => d.id);
  }

  // --- IPC Handlers ---

  ipcMain.handle('check-scrcpy', async () => {
    try {
      const { stdout } = await runCommand('which', ['scrcpy']);
      return { installed: true, path: stdout };
    } catch {
      return { installed: false, path: null };
    }
  });

  ipcMain.handle('get-connected-devices', async () => {
    try {
      const { stdout } = await runCommand('adb', ['devices']);
      const devices = parseAdbDevices(stdout);
      return { success: true, devices };
    } catch (err) {
      return { success: false, devices: [], error: err.message };
    }
  });

  ipcMain.on('start-mirror', (event, { deviceId }) => {
    if (mirrorProcess) {
      console.warn('[screen-mirror] Mirror already running. Stop it first.');
      return;
    }

    const args = ['-s', deviceId, '--window-title', 'Phone Mirror'];
    mirrorProcess = spawn('scrcpy', args, { stdio: 'ignore' });
    mirrorDeviceId = deviceId;

    config.lastDeviceId = deviceId;
    saveConfig();

    mirrorProcess.on('error', (err) => {
      console.error('[screen-mirror] scrcpy error:', err);
      mirrorProcess = null;
      mirrorDeviceId = null;
      const win = getMainWindow();
      if (win) {
        win.webContents.send('mirror-status-changed', { running: false, error: err.message });
      }
    });

    mirrorProcess.on('exit', (code) => {
      console.log(`[screen-mirror] scrcpy exited with code ${code}`);
      mirrorProcess = null;
      mirrorDeviceId = null;
      const win = getMainWindow();
      if (win) {
        win.webContents.send('mirror-status-changed', { running: false });
      }
    });

    const win = getMainWindow();
    if (win) {
      win.webContents.send('mirror-status-changed', { running: true, deviceId });
    }
  });

  ipcMain.on('stop-mirror', () => {
    if (mirrorProcess) {
      mirrorProcess.kill();
      mirrorProcess = null;
      mirrorDeviceId = null;
    }
  });

  ipcMain.handle('get-mirror-status', () => {
    return {
      running: !!mirrorProcess,
      deviceId: mirrorDeviceId,
      pid: mirrorProcess ? mirrorProcess.pid : null,
    };
  });

  ipcMain.on('install-scrcpy', () => {
    const platform = process.platform;
    if (platform === 'darwin') {
      const child = exec('brew install scrcpy', { timeout: 120000 });
      child.on('exit', (code) => {
        const win = getMainWindow();
        if (win) {
          win.webContents.send('scrcpy-install-result', {
            success: code === 0,
            message: code === 0 ? 'scrcpy installed successfully' : 'Installation failed. Please install manually: brew install scrcpy',
          });
        }
      });
      child.on('error', () => {
        const win = getMainWindow();
        if (win) {
          win.webContents.send('scrcpy-install-result', {
            success: false,
            message: 'Failed to run brew. Make sure Homebrew is installed.',
          });
        }
      });
    } else {
      const win = getMainWindow();
      if (win) {
        win.webContents.send('scrcpy-install-result', {
          success: false,
          message: 'Auto-install only supported on macOS via Homebrew. Visit https://github.com/Genymobile/scrcpy for installation instructions.',
        });
      }
    }
  });

  ipcMain.on('connect-wireless', (event, { ip }) => {
    const address = ip.includes(':') ? ip : `${ip}:5555`;
    exec(`adb connect ${address}`, { timeout: 10000 }, (error, stdout) => {
      const win = getMainWindow();
      if (win) {
        win.webContents.send('wireless-connect-result', {
          success: !error && stdout.includes('connected'),
          message: error ? error.message : stdout.trim(),
          ip: address,
        });
      }
    });
  });

  // --- Init ---

  loadConfig();
}

module.exports = { initScreenMirror };
