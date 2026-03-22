const http = require('http');
const fs = require('fs');
const path = require('path');

function initZapierIntegration({ app, ipcMain, getMainWindow, getViews, getActiveAccountId, getAccounts }) {
  const configPath = path.join(app.getPath('userData'), 'zapier-config.json');
  const PORT = 3378;

  let config = { enabled: false, triggerWebhookUrl: '', apiKey: '' };
  let server = null;
  let eventsQueue = [];
  let lastPollTimestamps = {
    'new-message': 0,
    'new-contact': 0,
    'status-change': 0,
  };

  // --- Persistence ---

  function loadConfig() {
    try {
      if (fs.existsSync(configPath)) {
        config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
      }
    } catch (err) {
      console.error('[zapier-integration] Failed to load config:', err);
    }
  }

  function saveConfig() {
    try {
      fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf-8');
    } catch (err) {
      console.error('[zapier-integration] Failed to save config:', err);
    }
  }

  // --- Events Queue ---

  function pushEvent(type, data) {
    const event = { type, data, timestamp: Date.now() };
    eventsQueue.push(event);
    if (eventsQueue.length > 100) {
      eventsQueue = eventsQueue.slice(-100);
    }
  }

  function getEventsSince(type, since) {
    return eventsQueue.filter((e) => e.type === type && e.timestamp > since);
  }

  // --- Authentication ---

  function authenticate(req) {
    const key = req.headers['x-zapier-key'];
    return key && key === config.apiKey;
  }

  // --- HTTP Server ---

  function parseBody(req) {
    return new Promise((resolve, reject) => {
      let body = '';
      req.on('data', (chunk) => { body += chunk; });
      req.on('end', () => {
        try {
          resolve(body ? JSON.parse(body) : {});
        } catch (err) {
          reject(err);
        }
      });
      req.on('error', reject);
    });
  }

  function sendJson(res, statusCode, data) {
    res.writeHead(statusCode, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(data));
  }

  function handleRequest(req, res) {
    if (!authenticate(req)) {
      return sendJson(res, 401, { error: 'Unauthorized. Provide X-Zapier-Key header.' });
    }

    const url = req.url;
    const method = req.method;

    // --- Trigger endpoints (GET) ---

    if (method === 'GET' && url === '/triggers/new-message') {
      const since = lastPollTimestamps['new-message'];
      const events = getEventsSince('new-message', since);
      lastPollTimestamps['new-message'] = Date.now();
      return sendJson(res, 200, events);
    }

    if (method === 'GET' && url === '/triggers/new-contact') {
      const since = lastPollTimestamps['new-contact'];
      const events = getEventsSince('new-contact', since);
      lastPollTimestamps['new-contact'] = Date.now();
      return sendJson(res, 200, events);
    }

    if (method === 'GET' && url === '/triggers/status-change') {
      const since = lastPollTimestamps['status-change'];
      const events = getEventsSince('status-change', since);
      lastPollTimestamps['status-change'] = Date.now();
      return sendJson(res, 200, events);
    }

    // --- Action endpoints (POST) ---

    if (method === 'POST' && url === '/actions/send-message') {
      parseBody(req).then(({ accountId, contact, message }) => {
        const win = getMainWindow();
        if (win) {
          win.webContents.send('zapier-send-message', { accountId, contact, message });
        }
        sendJson(res, 200, { success: true });
      }).catch(() => sendJson(res, 400, { error: 'Invalid JSON body' }));
      return;
    }

    if (method === 'POST' && url === '/actions/send-template') {
      parseBody(req).then(({ accountId, contact, templateId }) => {
        const win = getMainWindow();
        if (win) {
          win.webContents.send('zapier-send-template', { accountId, contact, templateId });
        }
        sendJson(res, 200, { success: true });
      }).catch(() => sendJson(res, 400, { error: 'Invalid JSON body' }));
      return;
    }

    if (method === 'POST' && url === '/actions/add-label') {
      parseBody(req).then(({ contactKey, labelId }) => {
        const win = getMainWindow();
        if (win) {
          win.webContents.send('zapier-add-label', { contactKey, labelId });
        }
        sendJson(res, 200, { success: true });
      }).catch(() => sendJson(res, 400, { error: 'Invalid JSON body' }));
      return;
    }

    if (method === 'POST' && url === '/actions/create-booking') {
      parseBody(req).then(({ date, time, customerName, customerPhone }) => {
        const win = getMainWindow();
        if (win) {
          win.webContents.send('zapier-create-booking', { date, time, customerName, customerPhone });
        }
        sendJson(res, 200, { success: true });
      }).catch(() => sendJson(res, 400, { error: 'Invalid JSON body' }));
      return;
    }

    sendJson(res, 404, { error: 'Not found' });
  }

  function startServer() {
    if (server) return;
    let currentPort = PORT;
    let retries = 0;
    const maxRetries = 5;

    server = http.createServer(handleRequest);

    server.on('error', (err) => {
      if (err.code === 'EADDRINUSE' && retries < maxRetries) {
        retries++;
        currentPort++;
        console.log(`[zapier-integration] Port ${currentPort - 1} in use, trying ${currentPort}...`);
        server.listen(currentPort, '127.0.0.1');
      } else {
        console.error(`[zapier-integration] Server failed to start: ${err.message}`);
        server = null;
      }
    });

    server.listen(currentPort, '127.0.0.1', () => {
      console.log(`[zapier-integration] HTTP server listening on port ${currentPort}`);
    });
  }

  function stopServer() {
    if (server) {
      server.close();
      server = null;
    }
  }

  // --- IPC Handlers ---

  ipcMain.handle('get-zapier-config', () => {
    return { ...config, serverRunning: !!server };
  });

  ipcMain.on('save-zapier-config', (event, { enabled, triggerWebhookUrl, apiKey }) => {
    config.enabled = !!enabled;
    config.triggerWebhookUrl = triggerWebhookUrl || '';
    if (apiKey !== undefined) config.apiKey = apiKey;
    saveConfig();

    if (config.enabled) {
      startServer();
    } else {
      stopServer();
    }
  });

  ipcMain.on('emit-zapier-event', (event, { type, data }) => {
    pushEvent(type, data);
  });

  // --- Init ---

  loadConfig();
  if (config.enabled) {
    startServer();
  }
}

module.exports = { initZapierIntegration };
