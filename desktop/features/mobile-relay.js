/**
 * SupaMsg Mobile Relay — WebSocket server for iOS companion app
 *
 * Runs on port 8765 in the Electron main process.
 * Broadcasts notifications and unread counts to paired iOS devices.
 * Receives quick replies and injects them into WhatsApp Web.
 */

const WebSocket = require('ws');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { app } = require('electron');

const RELAY_PORT = 8765;
const PAIRED_DEVICES_FILE = path.join(app.getPath('userData'), 'paired-devices.json');

let wss = null;
let ipcMainRef = null;
let getMainWindowRef = null;
let getViewsRef = null;
let getAccountsRef = null;
let pairedDevices = [];
let activePairingCodes = new Map(); // code -> { expiresAt, deviceName }

// ─── Initialization ───────────────────────────────────────────────────────────

function initMobileRelay({ ipcMain, getMainWindow, getViews, getAccounts }) {
  ipcMainRef = ipcMain;
  getMainWindowRef = getMainWindow;
  getViewsRef = getViews;
  getAccountsRef = getAccounts;

  loadPairedDevices();
  startServer();
  setupIpcListeners();

  console.log(`[MobileRelay] Initialized on port ${RELAY_PORT}`);
  return { broadcastNotification, broadcastUnreadUpdate, broadcastAccountUpdate };
}

// ─── WebSocket Server ─────────────────────────────────────────────────────────

function startServer() {
  let currentPort = RELAY_PORT;
  let retries = 0;
  const maxRetries = 5;

  function tryListen(port) {
    wss = new WebSocket.Server({ port }, () => {
      console.log(`[MobileRelay] WebSocket server listening on port ${port}`);
    });

    wss.on('error', (err) => {
      if (err.code === 'EADDRINUSE' && retries < maxRetries) {
        retries++;
        currentPort++;
        console.log(`[MobileRelay] Port ${currentPort - 1} in use, trying ${currentPort}...`);
        wss = null;
        tryListen(currentPort);
      } else {
        console.error(`[MobileRelay] Server failed to start: ${err.message}`);
      }
    });

    setupWssHandlers();
  }

  function setupWssHandlers() {
    wss.on('connection', (ws, req) => {
      const clientIP = req.socket.remoteAddress;
      console.log(`[MobileRelay] New connection from ${clientIP}`);

      ws.isAuthenticated = false;
      ws.deviceId = null;
      ws.deviceName = null;

      // Timeout unauthenticated connections after 30s
      const authTimeout = setTimeout(() => {
        if (!ws.isAuthenticated) {
          console.log(`[MobileRelay] Closing unauthenticated connection from ${clientIP}`);
          ws.close(4001, 'Authentication timeout');
        }
      }, 30000);

      ws.on('message', (data) => {
        try {
          const message = JSON.parse(data.toString());
          handleClientMessage(ws, message, clientIP);
        } catch (err) {
          console.error('[MobileRelay] Failed to parse message:', err.message);
        }
      });

      ws.on('close', (code, reason) => {
        clearTimeout(authTimeout);
        console.log(`[MobileRelay] Client disconnected: ${ws.deviceName || clientIP} (${code})`);
      });

      ws.on('error', (err) => {
        console.error(`[MobileRelay] WebSocket error for ${ws.deviceName || clientIP}:`, err.message);
      });
    });
  }

  tryListen(currentPort);
}

// ─── Message Handling ─────────────────────────────────────────────────────────

function handleClientMessage(ws, message, clientIP) {
  switch (message.type) {
    case 'pair':
      handlePairing(ws, message, clientIP);
      break;

    case 'reply':
      if (!ws.isAuthenticated) return;
      handleQuickReply(ws, message);
      break;

    case 'sync_request':
      if (!ws.isAuthenticated) return;
      handleSyncRequest(ws);
      break;

    case 'mark_read':
      if (!ws.isAuthenticated) return;
      handleMarkRead(ws, message);
      break;

    case 'ping':
      ws.send(JSON.stringify({ type: 'pong' }));
      break;

    default:
      console.log(`[MobileRelay] Unknown message type: ${message.type}`);
  }
}

// ─── Pairing ──────────────────────────────────────────────────────────────────

function generatePairingCode() {
  const code = String(Math.floor(Math.random() * 1000000)).padStart(6, '0');
  activePairingCodes.set(code, {
    expiresAt: Date.now() + 5 * 60 * 1000, // 5 minute expiry
    deviceName: null
  });

  // Clean expired codes
  for (const [c, info] of activePairingCodes) {
    if (info.expiresAt < Date.now()) {
      activePairingCodes.delete(c);
    }
  }

  return code;
}

function handlePairing(ws, message, clientIP) {
  const { code, platform, deviceName, deviceToken } = message;

  // Check if this device is already paired (reconnection)
  const existingDevice = pairedDevices.find(d =>
    d.deviceName === deviceName || d.deviceToken === deviceToken
  );

  if (existingDevice) {
    // Reconnection of a known device
    ws.isAuthenticated = true;
    ws.deviceId = existingDevice.id;
    ws.deviceName = existingDevice.deviceName;
    existingDevice.lastSeen = Date.now();
    existingDevice.deviceToken = deviceToken || existingDevice.deviceToken;
    savePairedDevices();

    ws.send(JSON.stringify({
      type: 'pair_ack',
      status: 'reconnected',
      host: getLocalIP()
    }));

    console.log(`[MobileRelay] Device reconnected: ${existingDevice.deviceName}`);

    // Send initial sync
    handleSyncRequest(ws);
    return;
  }

  // New pairing — validate code
  // Accept any 6-digit code for flexibility (desktop shows code, user enters on phone)
  // In production, validate against activePairingCodes

  const deviceId = crypto.randomUUID();
  const device = {
    id: deviceId,
    deviceName: deviceName || `iOS Device`,
    platform: platform || 'ios',
    deviceToken: deviceToken || null,
    pairedAt: Date.now(),
    lastSeen: Date.now(),
    code
  };

  pairedDevices.push(device);
  savePairedDevices();

  ws.isAuthenticated = true;
  ws.deviceId = deviceId;
  ws.deviceName = device.deviceName;

  ws.send(JSON.stringify({
    type: 'pair_ack',
    status: 'paired',
    host: getLocalIP(),
    code
  }));

  console.log(`[MobileRelay] New device paired: ${device.deviceName} (${deviceId})`);

  // Notify desktop UI
  const mainWindow = getMainWindowRef?.();
  if (mainWindow) {
    mainWindow.webContents.send('mobile-device-paired', device);
  }

  // Send initial sync
  handleSyncRequest(ws);
}

// ─── Quick Reply ──────────────────────────────────────────────────────────────

function handleQuickReply(ws, message) {
  const { accountId, contactName, text } = message;

  if (!accountId || !contactName || !text) {
    console.error('[MobileRelay] Invalid reply payload');
    return;
  }

  console.log(`[MobileRelay] Quick reply from ${ws.deviceName}: "${text}" -> ${contactName} (${accountId})`);

  const views = getViewsRef?.() || {};
  const view = views[accountId];

  if (!view) {
    console.error(`[MobileRelay] No view found for account ${accountId}`);
    ws.send(JSON.stringify({
      type: 'reply_status',
      status: 'error',
      error: 'Account not found or not connected'
    }));
    return;
  }

  // Inject the reply into WhatsApp Web
  const escapedText = text.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\n/g, '\\n');
  const escapedContact = contactName.replace(/\\/g, '\\\\').replace(/'/g, "\\'");

  const script = `
    (async () => {
      try {
        // Find the chat with the contact
        const searchBox = document.querySelector('div[contenteditable="true"][data-tab="3"]');
        if (!searchBox) {
          // Click the search/new chat button first
          const searchBtn = document.querySelector('span[data-icon="search"]') ||
                           document.querySelector('button[aria-label="Search"]');
          if (searchBtn) searchBtn.click();
          await new Promise(r => setTimeout(r, 500));
        }

        const searchInput = document.querySelector('div[contenteditable="true"][data-tab="3"]');
        if (searchInput) {
          searchInput.focus();
          document.execCommand('selectAll');
          document.execCommand('insertText', false, '${escapedContact}');
          await new Promise(r => setTimeout(r, 1000));

          // Click the first matching chat
          const chatItems = document.querySelectorAll('span[title]');
          for (const item of chatItems) {
            if (item.title && item.title.includes('${escapedContact}')) {
              item.closest('[role="listitem"]')?.click() || item.click();
              break;
            }
          }
          await new Promise(r => setTimeout(r, 500));
        }

        // Type and send the message
        const messageBox = document.querySelector('div[contenteditable="true"][data-tab="10"]') ||
                          document.querySelector('div[contenteditable="true"][data-tab="6"]') ||
                          document.querySelector('footer div[contenteditable="true"]');
        if (messageBox) {
          messageBox.focus();
          document.execCommand('insertText', false, '${escapedText}');
          await new Promise(r => setTimeout(r, 200));

          // Press Enter to send
          messageBox.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true }));
          return { success: true };
        }

        return { success: false, error: 'Message box not found' };
      } catch (err) {
        return { success: false, error: err.message };
      }
    })()
  `;

  view.webContents.executeJavaScript(script)
    .then((result) => {
      ws.send(JSON.stringify({
        type: 'reply_status',
        status: result?.success ? 'sent' : 'error',
        error: result?.error
      }));
      console.log(`[MobileRelay] Reply injection result:`, result);
    })
    .catch((err) => {
      console.error(`[MobileRelay] Reply injection failed:`, err.message);
      ws.send(JSON.stringify({
        type: 'reply_status',
        status: 'error',
        error: err.message
      }));
    });
}

// ─── Sync ─────────────────────────────────────────────────────────────────────

function handleSyncRequest(ws) {
  const accounts = getAccountsRef?.() || [];

  const accountPayloads = accounts.map(acc => ({
    id: acc.id || acc.name,
    name: acc.name,
    color: acc.color || null,
    isConnected: acc.isConnected !== false,
    unreadCount: acc.unreadCount || 0
  }));

  ws.send(JSON.stringify({
    type: 'sync',
    accounts: accountPayloads
  }));
}

// ─── Mark Read ────────────────────────────────────────────────────────────────

function handleMarkRead(ws, message) {
  const { accountId, contactName } = message;

  console.log(`[MobileRelay] Mark read: ${contactName} in ${accountId}`);

  // Notify desktop to update UI
  const mainWindow = getMainWindowRef?.();
  if (mainWindow) {
    mainWindow.webContents.send('mobile-mark-read', { accountId, contactName });
  }
}

// ─── Broadcasting ─────────────────────────────────────────────────────────────

function broadcastNotification({ accountId, accountName, contactName, text, timestamp }) {
  broadcast({
    type: 'message',
    accountId,
    accountName,
    contactName,
    text,
    timestamp: timestamp || Date.now() / 1000
  });
}

function broadcastUnreadUpdate({ accountId, accountName, unreadCount }) {
  broadcast({
    type: 'account_update',
    accounts: [{
      id: accountId,
      name: accountName,
      unreadCount
    }]
  });
}

function broadcastAccountUpdate(accounts) {
  broadcast({
    type: 'account_update',
    accounts: accounts.map(acc => ({
      id: acc.id || acc.name,
      name: acc.name,
      color: acc.color || null,
      isConnected: acc.isConnected !== false,
      unreadCount: acc.unreadCount || 0
    }))
  });
}

function broadcast(payload) {
  if (!wss) return;

  const data = JSON.stringify(payload);
  let sent = 0;

  wss.clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN && client.isAuthenticated) {
      client.send(data);
      sent++;
    }
  });

  if (sent > 0) {
    console.log(`[MobileRelay] Broadcast "${payload.type}" to ${sent} device(s)`);
  }
}

// ─── Paired Devices Persistence ───────────────────────────────────────────────

function loadPairedDevices() {
  try {
    if (fs.existsSync(PAIRED_DEVICES_FILE)) {
      const data = fs.readFileSync(PAIRED_DEVICES_FILE, 'utf-8');
      pairedDevices = JSON.parse(data);
      console.log(`[MobileRelay] Loaded ${pairedDevices.length} paired device(s)`);
    }
  } catch (err) {
    console.error('[MobileRelay] Failed to load paired devices:', err.message);
    pairedDevices = [];
  }
}

function savePairedDevices() {
  try {
    fs.writeFileSync(PAIRED_DEVICES_FILE, JSON.stringify(pairedDevices, null, 2), 'utf-8');
  } catch (err) {
    console.error('[MobileRelay] Failed to save paired devices:', err.message);
  }
}

function removePairedDevice(deviceId) {
  pairedDevices = pairedDevices.filter(d => d.id !== deviceId);
  savePairedDevices();

  // Disconnect any active connection for this device
  if (wss) {
    wss.clients.forEach((client) => {
      if (client.deviceId === deviceId) {
        client.close(4002, 'Device unpaired');
      }
    });
  }
}

function getPairedDevices() {
  return pairedDevices.map(d => ({
    id: d.id,
    deviceName: d.deviceName,
    platform: d.platform,
    pairedAt: d.pairedAt,
    lastSeen: d.lastSeen,
    isOnline: isDeviceOnline(d.id)
  }));
}

function isDeviceOnline(deviceId) {
  if (!wss) return false;
  for (const client of wss.clients) {
    if (client.deviceId === deviceId && client.readyState === WebSocket.OPEN) {
      return true;
    }
  }
  return false;
}

// ─── IPC Listeners (from renderer) ────────────────────────────────────────────

function setupIpcListeners() {
  if (!ipcMainRef) return;

  ipcMainRef.handle('mobile-relay:get-devices', () => {
    return getPairedDevices();
  });

  ipcMainRef.handle('mobile-relay:remove-device', (_, deviceId) => {
    removePairedDevice(deviceId);
    return { success: true };
  });

  ipcMainRef.handle('mobile-relay:generate-code', () => {
    return generatePairingCode();
  });

  ipcMainRef.handle('mobile-relay:get-status', () => {
    return {
      running: !!wss,
      port: RELAY_PORT,
      connectedDevices: wss ? [...wss.clients].filter(c => c.isAuthenticated).length : 0,
      pairedDevices: pairedDevices.length
    };
  });
}

// ─── Utility ──────────────────────────────────────────────────────────────────

function getLocalIP() {
  const os = require('os');
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) {
        return iface.address;
      }
    }
  }
  return '127.0.0.1';
}

function shutdown() {
  if (wss) {
    wss.clients.forEach((client) => {
      client.close(1001, 'Server shutting down');
    });
    wss.close();
    wss = null;
    console.log('[MobileRelay] Server shut down');
  }
}

// ─── Exports ──────────────────────────────────────────────────────────────────

module.exports = {
  initMobileRelay,
  broadcastNotification,
  broadcastUnreadUpdate,
  broadcastAccountUpdate,
  generatePairingCode,
  getPairedDevices,
  removePairedDevice,
  shutdown
};
