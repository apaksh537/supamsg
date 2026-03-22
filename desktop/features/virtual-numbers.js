const fs = require('fs');
const path = require('path');
const https = require('https');

function initVirtualNumbers({ app, ipcMain, getMainWindow, getViews, getActiveAccountId, getAccounts }) {
  const twilioConfigPath = path.join(app.getPath('userData'), 'twilio-config.json');
  const numbersPath = path.join(app.getPath('userData'), 'virtual-numbers.json');

  let twilioConfig = { accountSid: '', authToken: '', configured: false };
  let ownedNumbers = [];

  // --- Persistence ---

  function loadTwilioConfig() {
    try {
      if (fs.existsSync(twilioConfigPath)) {
        twilioConfig = JSON.parse(fs.readFileSync(twilioConfigPath, 'utf-8'));
      }
    } catch (err) {
      console.error('[virtual-numbers] Failed to load Twilio config:', err);
    }
  }

  function saveTwilioConfig() {
    try {
      fs.writeFileSync(twilioConfigPath, JSON.stringify(twilioConfig, null, 2), 'utf-8');
    } catch (err) {
      console.error('[virtual-numbers] Failed to save Twilio config:', err);
    }
  }

  function loadNumbers() {
    try {
      if (fs.existsSync(numbersPath)) {
        ownedNumbers = JSON.parse(fs.readFileSync(numbersPath, 'utf-8'));
      }
    } catch (err) {
      console.error('[virtual-numbers] Failed to load numbers:', err);
      ownedNumbers = [];
    }
  }

  function saveNumbers() {
    try {
      fs.writeFileSync(numbersPath, JSON.stringify(ownedNumbers, null, 2), 'utf-8');
    } catch (err) {
      console.error('[virtual-numbers] Failed to save numbers:', err);
    }
  }

  // --- Twilio API ---

  function twilioRequest(method, apiPath, body) {
    return new Promise((resolve, reject) => {
      if (!twilioConfig.accountSid || !twilioConfig.authToken) {
        return reject(new Error('Twilio credentials not configured'));
      }

      const auth = Buffer.from(`${twilioConfig.accountSid}:${twilioConfig.authToken}`).toString('base64');
      const postData = body ? new URLSearchParams(body).toString() : null;

      const options = {
        hostname: 'api.twilio.com',
        port: 443,
        path: `/2010-04-01/Accounts/${twilioConfig.accountSid}${apiPath}`,
        method,
        headers: {
          'Authorization': `Basic ${auth}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
      };

      if (postData) {
        options.headers['Content-Length'] = Buffer.byteLength(postData);
      }

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
      if (postData) req.write(postData);
      req.end();
    });
  }

  // --- IPC Handlers ---

  ipcMain.handle('get-twilio-config', () => {
    return {
      accountSid: twilioConfig.accountSid,
      configured: twilioConfig.configured,
      // Don't expose authToken to renderer
    };
  });

  ipcMain.on('save-twilio-config', (event, { accountSid, authToken }) => {
    twilioConfig.accountSid = accountSid || '';
    twilioConfig.authToken = authToken || '';
    twilioConfig.configured = !!(accountSid && authToken);
    saveTwilioConfig();
  });

  ipcMain.handle('search-numbers', async (event, { country, type }) => {
    try {
      const numberType = type || 'Local';
      const apiPath = `/AvailablePhoneNumbers/${country || 'US'}/${numberType}.json`;
      const result = await twilioRequest('GET', apiPath);
      return {
        success: true,
        numbers: (result.available_phone_numbers || []).map((n) => ({
          phoneNumber: n.phone_number,
          friendlyName: n.friendly_name,
          locality: n.locality,
          region: n.region,
          capabilities: n.capabilities,
        })),
      };
    } catch (err) {
      return { success: false, numbers: [], error: err.message };
    }
  });

  ipcMain.handle('buy-number', async (event, { phoneNumber }) => {
    try {
      const result = await twilioRequest('POST', '/IncomingPhoneNumbers.json', {
        PhoneNumber: phoneNumber,
      });

      const purchased = {
        sid: result.sid,
        phoneNumber: result.phone_number,
        friendlyName: result.friendly_name,
        dateCreated: result.date_created,
      };

      ownedNumbers.push(purchased);
      saveNumbers();

      return { success: true, number: purchased };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('get-owned-numbers', () => {
    return [...ownedNumbers];
  });

  ipcMain.on('release-number', async (event, { numberSid }) => {
    try {
      await twilioRequest('DELETE', `/IncomingPhoneNumbers/${numberSid}.json`);
      ownedNumbers = ownedNumbers.filter((n) => n.sid !== numberSid);
      saveNumbers();
      const win = getMainWindow();
      if (win) {
        win.webContents.send('number-released', { numberSid, success: true });
      }
    } catch (err) {
      const win = getMainWindow();
      if (win) {
        win.webContents.send('number-released', { numberSid, success: false, error: err.message });
      }
    }
  });

  ipcMain.handle('send-sms', async (event, { from, to, body }) => {
    try {
      const result = await twilioRequest('POST', '/Messages.json', {
        From: from,
        To: to,
        Body: body,
      });
      return { success: true, messageSid: result.sid, status: result.status };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  // --- Init ---

  loadTwilioConfig();
  loadNumbers();
}

module.exports = { initVirtualNumbers };
