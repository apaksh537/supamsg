// Webhook API & Developer Platform: REST API + webhooks for external integrations
// HTTP server on port 3377 with API key authentication

const path = require('path');
const fs = require('fs');
const http = require('http');
const https = require('https');
const crypto = require('crypto');

let configPath;
let apiConfig = { enabled: false, apiKey: '', webhookUrl: '', port: 3377 };
let server = null;
let getViewsRef = null;
let getAccountsRef = null;
let getActiveAccountIdRef = null;
let getMainWindowRef = null;

function initWebhookApi({ app, ipcMain, getMainWindow, getViews, getActiveAccountId, getAccounts }) {
  configPath = path.join(app.getPath('userData'), 'api-config.json');
  getViewsRef = getViews;
  getAccountsRef = getAccounts;
  getActiveAccountIdRef = getActiveAccountId;
  getMainWindowRef = getMainWindow;

  loadConfig();

  // Generate default API key on first run
  if (!apiConfig.apiKey) {
    apiConfig.apiKey = crypto.randomBytes(32).toString('hex');
    saveConfig();
  }

  if (apiConfig.enabled) {
    startServer();
  }

  ipcMain.handle('get-api-config', () => ({
    port: apiConfig.port,
    apiKey: apiConfig.apiKey,
    enabled: apiConfig.enabled,
    webhookUrl: apiConfig.webhookUrl,
  }));

  ipcMain.on('save-api-config', (_event, { enabled, apiKey, webhookUrl }) => {
    const wasEnabled = apiConfig.enabled;
    apiConfig.enabled = enabled;
    if (apiKey) apiConfig.apiKey = apiKey;
    if (webhookUrl !== undefined) apiConfig.webhookUrl = webhookUrl;
    saveConfig();

    if (enabled && !wasEnabled) {
      startServer();
    } else if (!enabled && wasEnabled) {
      stopServer();
    } else if (enabled && wasEnabled) {
      stopServer();
      startServer();
    }
  });

  ipcMain.on('regenerate-api-key', () => {
    apiConfig.apiKey = crypto.randomBytes(32).toString('hex');
    saveConfig();
    const win = getMainWindow();
    if (win && !win.isDestroyed()) {
      win.webContents.send('api-key-updated', apiConfig.apiKey);
    }
  });
}

function loadConfig() {
  try {
    if (fs.existsSync(configPath)) {
      apiConfig = { ...apiConfig, ...JSON.parse(fs.readFileSync(configPath, 'utf-8')) };
    }
  } catch (err) {
    console.error('[webhook-api] Failed to load config:', err.message);
  }
}

function saveConfig() {
  try {
    fs.writeFileSync(configPath, JSON.stringify(apiConfig, null, 2));
  } catch (err) {
    console.error('[webhook-api] Failed to save config:', err.message);
  }
}

function authenticate(req) {
  const key = req.headers['x-api-key'];
  return key === apiConfig.apiKey;
}

function jsonResponse(res, statusCode, data) {
  res.writeHead(statusCode, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
}

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

function startServer() {
  if (server) return;
  let currentPort = apiConfig.port;
  let retries = 0;
  const maxRetries = 5;

  server = http.createServer(async (req, res) => {
    // CORS headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-API-Key');

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    const url = new URL(req.url, `http://localhost:${currentPort}`);
    const pathname = url.pathname;

    // Health check (no auth required)
    if (pathname === '/api/status' && req.method === 'GET') {
      return jsonResponse(res, 200, { status: 'ok', timestamp: new Date().toISOString() });
    }

    // Auth required for all other endpoints
    if (!authenticate(req)) {
      return jsonResponse(res, 401, { error: 'Unauthorized. Provide X-API-Key header.' });
    }

    try {
      await handleRoute(req, res, pathname);
    } catch (err) {
      console.error('[webhook-api] Request error:', err.message);
      jsonResponse(res, 500, { error: 'Internal server error' });
    }
  });

  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE' && retries < maxRetries) {
      retries++;
      currentPort++;
      console.log(`[webhook-api] Port ${currentPort - 1} in use, trying ${currentPort}...`);
      server.listen(currentPort);
    } else {
      console.error(`[webhook-api] Server failed to start: ${err.message}`);
    }
  });

  server.listen(currentPort, () => {
    apiConfig.port = currentPort;
    console.log(`[webhook-api] API server running on port ${currentPort}`);
  });
}

function stopServer() {
  if (server) {
    server.close();
    server = null;
  }
}

async function handleRoute(req, res, pathname) {
  const accounts = getAccountsRef ? getAccountsRef() : [];
  const views = getViewsRef ? getViewsRef() : {};

  // GET /api/accounts
  if (pathname === '/api/accounts' && req.method === 'GET') {
    return jsonResponse(res, 200, {
      accounts: accounts.map((a) => ({ id: a.id, name: a.name || a.id })),
    });
  }

  // GET /api/messages/:accountId
  const messagesMatch = pathname.match(/^\/api\/messages\/(.+)$/);
  if (messagesMatch && req.method === 'GET') {
    const accountId = messagesMatch[1];
    if (!views[accountId]) {
      return jsonResponse(res, 404, { error: 'Account not found or not connected' });
    }
    try {
      const messages = await views[accountId].webContents.executeJavaScript(`
        (function() {
          const rows = document.querySelectorAll('div.message-in, div.message-out');
          const msgs = [];
          const slice = Array.from(rows).slice(-50);
          for (const row of slice) {
            const textEl = row.querySelector('span.selectable-text');
            const timeEl = row.querySelector('span[data-testid="msg-time"]');
            msgs.push({
              direction: row.classList.contains('message-in') ? 'in' : 'out',
              text: textEl ? textEl.innerText : '',
              time: timeEl ? timeEl.innerText : '',
            });
          }
          return msgs;
        })();
      `);
      return jsonResponse(res, 200, { messages });
    } catch (err) {
      return jsonResponse(res, 500, { error: 'Failed to scrape messages' });
    }
  }

  // POST /api/send
  if (pathname === '/api/send' && req.method === 'POST') {
    const body = await parseBody(req);
    const { accountId, contact, message } = body;
    if (!accountId || !contact || !message) {
      return jsonResponse(res, 400, { error: 'Missing accountId, contact, or message' });
    }
    if (!views[accountId]) {
      return jsonResponse(res, 404, { error: 'Account not found or not connected' });
    }
    try {
      await views[accountId].webContents.executeJavaScript(`
        (function() {
          const searchBox = document.querySelector('div[contenteditable="true"][data-tab="3"]');
          if (searchBox) {
            searchBox.focus();
            document.execCommand('insertText', false, ${JSON.stringify(contact)});
          }
        })();
      `);
      // Wait for search results, then click contact and type message
      await new Promise((r) => setTimeout(r, 2000));
      await views[accountId].webContents.executeJavaScript(`
        (function() {
          const results = document.querySelectorAll('span[title]');
          for (const r of results) {
            if (r.title && r.title.includes(${JSON.stringify(contact)})) {
              r.click();
              break;
            }
          }
        })();
      `);
      await new Promise((r) => setTimeout(r, 1000));
      await views[accountId].webContents.executeJavaScript(`
        (function() {
          const editableDiv = document.querySelector('div[contenteditable="true"][data-tab="10"]');
          if (!editableDiv) return false;
          editableDiv.focus();
          document.execCommand('insertText', false, ${JSON.stringify(message)});
          setTimeout(() => {
            const sendBtn = document.querySelector('button[data-tab="11"]') || document.querySelector('span[data-icon="send"]');
            if (sendBtn) sendBtn.click();
          }, 300);
          return true;
        })();
      `);
      sendWebhook('message.sent', { accountId, contact, message });
      return jsonResponse(res, 200, { sent: true });
    } catch (err) {
      return jsonResponse(res, 500, { error: 'Failed to send message' });
    }
  }

  // GET /api/labels
  if (pathname === '/api/labels' && req.method === 'GET') {
    try {
      const labelsPath = path.join(path.dirname(configPath), 'labels.json');
      if (fs.existsSync(labelsPath)) {
        const labels = JSON.parse(fs.readFileSync(labelsPath, 'utf-8'));
        return jsonResponse(res, 200, { labels });
      }
      return jsonResponse(res, 200, { labels: [] });
    } catch (err) {
      return jsonResponse(res, 500, { error: 'Failed to read labels' });
    }
  }

  // GET /api/templates
  if (pathname === '/api/templates' && req.method === 'GET') {
    try {
      const templatesPath = path.join(path.dirname(configPath), 'templates.json');
      if (fs.existsSync(templatesPath)) {
        const templates = JSON.parse(fs.readFileSync(templatesPath, 'utf-8'));
        return jsonResponse(res, 200, { templates });
      }
      return jsonResponse(res, 200, { templates: [] });
    } catch (err) {
      return jsonResponse(res, 500, { error: 'Failed to read templates' });
    }
  }

  // POST /api/broadcast
  if (pathname === '/api/broadcast' && req.method === 'POST') {
    const body = await parseBody(req);
    const { accountId, contacts, message } = body;
    if (!accountId || !contacts || !message) {
      return jsonResponse(res, 400, { error: 'Missing accountId, contacts, or message' });
    }
    if (!views[accountId]) {
      return jsonResponse(res, 404, { error: 'Account not found or not connected' });
    }
    const results = [];
    for (const contact of contacts) {
      try {
        await views[accountId].webContents.executeJavaScript(`
          (function() {
            const searchBox = document.querySelector('div[contenteditable="true"][data-tab="3"]');
            if (searchBox) {
              searchBox.focus();
              document.execCommand('selectAll');
              document.execCommand('insertText', false, ${JSON.stringify(contact)});
            }
          })();
        `);
        await new Promise((r) => setTimeout(r, 2000));
        await views[accountId].webContents.executeJavaScript(`
          (function() {
            const results = document.querySelectorAll('span[title]');
            for (const r of results) {
              if (r.title && r.title.includes(${JSON.stringify(contact)})) {
                r.click();
                break;
              }
            }
          })();
        `);
        await new Promise((r) => setTimeout(r, 1000));
        await views[accountId].webContents.executeJavaScript(`
          (function() {
            const editableDiv = document.querySelector('div[contenteditable="true"][data-tab="10"]');
            if (!editableDiv) return false;
            editableDiv.focus();
            document.execCommand('insertText', false, ${JSON.stringify(message)});
            setTimeout(() => {
              const sendBtn = document.querySelector('button[data-tab="11"]') || document.querySelector('span[data-icon="send"]');
              if (sendBtn) sendBtn.click();
            }, 300);
            return true;
          })();
        `);
        results.push({ contact, sent: true });
      } catch (err) {
        results.push({ contact, sent: false, error: err.message });
      }
    }
    sendWebhook('message.sent', { accountId, broadcast: true, contacts, message });
    return jsonResponse(res, 200, { results });
  }

  return jsonResponse(res, 404, { error: 'Not found' });
}

function sendWebhook(event, data) {
  if (!apiConfig.webhookUrl) return;

  const payload = JSON.stringify({
    event,
    timestamp: new Date().toISOString(),
    data,
  });

  try {
    const url = new URL(apiConfig.webhookUrl);
    const mod = url.protocol === 'https:' ? https : http;
    const req = mod.request(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload),
      },
    });
    req.on('error', (err) => {
      console.error('[webhook-api] Webhook delivery failed:', err.message);
    });
    req.write(payload);
    req.end();
  } catch (err) {
    console.error('[webhook-api] Webhook URL error:', err.message);
  }
}

// Exported for other modules to trigger webhook events
function emitWebhookEvent(event, data) {
  sendWebhook(event, data);
}

module.exports = { initWebhookApi, emitWebhookEvent };
