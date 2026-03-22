const fs = require('fs');
const path = require('path');
const https = require('https');

function initSmsBridge({ app, ipcMain, getMainWindow, getViews, getActiveAccountId, getAccounts }) {
  const configPath = path.join(app.getPath('userData'), 'sms-config.json');
  const historyPath = path.join(app.getPath('userData'), 'sms-history.json');
  const fallbacksPath = path.join(app.getPath('userData'), 'sms-fallbacks.json');

  let config = { twilioSid: '', twilioAuth: '', fromNumber: '', enabled: false, webhookUrl: '' };
  let history = [];
  let fallbacks = {};

  // --- Persistence ---

  function loadConfig() {
    try {
      if (fs.existsSync(configPath)) {
        config = { ...config, ...JSON.parse(fs.readFileSync(configPath, 'utf-8')) };
      }
    } catch (err) {
      console.error('[sms-bridge] Failed to load config:', err);
    }
  }

  function saveConfig() {
    try {
      fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf-8');
    } catch (err) {
      console.error('[sms-bridge] Failed to save config:', err);
    }
  }

  function loadHistory() {
    try {
      if (fs.existsSync(historyPath)) {
        history = JSON.parse(fs.readFileSync(historyPath, 'utf-8'));
      }
    } catch (err) {
      console.error('[sms-bridge] Failed to load history:', err);
      history = [];
    }
  }

  function saveHistory() {
    try {
      fs.writeFileSync(historyPath, JSON.stringify(history, null, 2), 'utf-8');
    } catch (err) {
      console.error('[sms-bridge] Failed to save history:', err);
    }
  }

  function loadFallbacks() {
    try {
      if (fs.existsSync(fallbacksPath)) {
        fallbacks = JSON.parse(fs.readFileSync(fallbacksPath, 'utf-8'));
      }
    } catch (err) {
      console.error('[sms-bridge] Failed to load fallbacks:', err);
      fallbacks = {};
    }
  }

  function saveFallbacks() {
    try {
      fs.writeFileSync(fallbacksPath, JSON.stringify(fallbacks, null, 2), 'utf-8');
    } catch (err) {
      console.error('[sms-bridge] Failed to save fallbacks:', err);
    }
  }

  // --- Twilio API ---

  function sendViaTwilio(to, message) {
    return new Promise((resolve, reject) => {
      if (!config.twilioSid || !config.twilioAuth || !config.fromNumber) {
        return reject(new Error('Twilio SMS credentials not configured'));
      }

      const auth = Buffer.from(`${config.twilioSid}:${config.twilioAuth}`).toString('base64');
      const postData = new URLSearchParams({
        From: config.fromNumber,
        To: to,
        Body: message,
      }).toString();

      const options = {
        hostname: 'api.twilio.com',
        port: 443,
        path: `/2010-04-01/Accounts/${config.twilioSid}/Messages.json`,
        method: 'POST',
        headers: {
          'Authorization': `Basic ${auth}`,
          'Content-Type': 'application/x-www-form-urlencoded',
          'Content-Length': Buffer.byteLength(postData),
        },
      };

      const req = https.request(options, (res) => {
        let data = '';
        res.on('data', (chunk) => { data += chunk; });
        res.on('end', () => {
          try {
            const parsed = JSON.parse(data);
            if (res.statusCode >= 200 && res.statusCode < 300) {
              resolve(parsed);
            } else {
              reject(new Error(parsed.message || `Twilio API error: ${res.statusCode}`));
            }
          } catch {
            reject(new Error(`Failed to parse Twilio response: ${data}`));
          }
        });
      });

      req.on('error', reject);
      req.write(postData);
      req.end();
    });
  }

  // --- IPC Handlers ---

  ipcMain.handle('get-sms-config', () => {
    return {
      twilioSid: config.twilioSid,
      fromNumber: config.fromNumber,
      enabled: config.enabled,
      webhookUrl: config.webhookUrl,
      configured: !!(config.twilioSid && config.twilioAuth && config.fromNumber),
      // Don't expose twilioAuth to renderer
    };
  });

  ipcMain.on('save-sms-config', (event, { twilioSid, twilioAuth, fromNumber, enabled }) => {
    config.twilioSid = twilioSid || config.twilioSid;
    config.twilioAuth = twilioAuth || config.twilioAuth;
    config.fromNumber = fromNumber || config.fromNumber;
    config.enabled = enabled !== undefined ? !!enabled : config.enabled;
    saveConfig();
  });

  ipcMain.handle('send-sms', async (event, { to, message }) => {
    if (!config.enabled) {
      return { success: false, error: 'SMS bridge is not enabled' };
    }

    try {
      const result = await sendViaTwilio(to, message);

      const entry = {
        id: result.sid,
        direction: 'outgoing',
        from: config.fromNumber,
        to,
        message,
        status: result.status,
        timestamp: Date.now(),
      };
      history.push(entry);
      saveHistory();

      return { success: true, messageSid: result.sid, status: result.status };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('get-sms-history', () => {
    return [...history];
  });

  ipcMain.on('set-sms-fallback', (event, { contactKey, phoneNumber, enabled }) => {
    if (enabled) {
      fallbacks[contactKey] = { phoneNumber, enabled: true, createdAt: Date.now() };
    } else {
      delete fallbacks[contactKey];
    }
    saveFallbacks();
  });

  ipcMain.handle('get-sms-fallbacks', () => {
    return { ...fallbacks };
  });

  ipcMain.on('set-sms-webhook-url', (event, { url }) => {
    config.webhookUrl = url || '';
    saveConfig();
  });

  // --- Init ---

  loadConfig();
  loadHistory();
  loadFallbacks();
}

module.exports = { initSmsBridge };
