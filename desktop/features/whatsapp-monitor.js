// WhatsApp Web warning signal & rate-limit monitor
// Injects MutationObserver into each account's WebView to detect bans,
// rate limits, and reported indicators, then notifies smart outreach to pause.

const path = require('path');
const fs = require('fs');

// ── State ────────────────────────────────────────────────────

let warningsPath;
let warnings = {}; // accountId -> [{ type, text, pattern, timestamp }]
let appRef;
let ipcMainRef;
let getMainWindowRef;
let getViewsRef;
let getAccountsRef;

const WARNING_TTL = 24 * 60 * 60 * 1000; // 24 hours

// ── Injected script (stringified and executed in WebView context) ────

function buildInjectedScript() {
  return `
(function() {
  if (window.__SUPAMSG_MONITOR_ACTIVE__) return;
  window.__SUPAMSG_MONITOR_ACTIVE__ = true;

  const WARNING_PATTERNS = [
    /not allowed/i,
    /temporarily banned/i,
    /been banned/i,
    /try again later/i,
    /too many/i,
    /couldn't send/i,
    /failed to send/i,
    /been reported/i,
    /policy violation/i,
    /spam/i,
    /unusual activity/i,
  ];

  let lastWarningTime = 0;
  const COOLDOWN = 30000;

  function checkNode(node) {
    if (!node || node.nodeType !== 1) return;
    const text = (node.textContent || '').trim();
    if (!text || text.length > 500) return;

    for (const pattern of WARNING_PATTERNS) {
      if (pattern.test(text)) {
        const now = Date.now();
        if (now - lastWarningTime > COOLDOWN) {
          lastWarningTime = now;
          window.postMessage({
            type: 'supamsg-whatsapp-warning',
            payload: {
              type: 'whatsapp-warning',
              text: text.substring(0, 200),
              pattern: pattern.source,
              timestamp: new Date().toISOString(),
            },
          }, '*');
        }
        return;
      }
    }
  }

  const observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      for (const node of mutation.addedNodes) {
        checkNode(node);
        // Also check children in case the warning is nested
        if (node.nodeType === 1 && node.querySelectorAll) {
          try {
            const children = node.querySelectorAll('div, span, p, h1, h2, h3');
            for (const child of children) {
              checkNode(child);
            }
          } catch (_) { /* safe guard */ }
        }
      }
    }
  });

  if (document.body) {
    observer.observe(document.body, { childList: true, subtree: true });
  } else {
    document.addEventListener('DOMContentLoaded', () => {
      observer.observe(document.body, { childList: true, subtree: true });
    });
  }

  // Periodic check for send-failure indicators
  setInterval(() => {
    try {
      // Clock icons on outgoing messages indicate unsent messages
      const pendingIcons = document.querySelectorAll(
        '[data-testid="msg-time"] [data-icon="msg-time"], ' +
        '[data-icon="msg-time"], ' +
        '[data-testid="msg-clock"]'
      );
      // If many pending messages exist, it may indicate a rate limit
      if (pendingIcons.length >= 5) {
        const now = Date.now();
        if (now - lastWarningTime > COOLDOWN) {
          lastWarningTime = now;
          window.postMessage({
            type: 'supamsg-whatsapp-warning',
            payload: {
              type: 'whatsapp-warning',
              text: 'Multiple messages stuck sending (' + pendingIcons.length + ' pending)',
              pattern: 'send-failure-batch',
              timestamp: new Date().toISOString(),
            },
          }, '*');
        }
      }

      // Check for error/alert modals
      const modals = document.querySelectorAll(
        '[data-testid="popup-contents"], ' +
        '[role="dialog"], ' +
        '[data-testid="alert-message"], ' +
        '.overlay [role="alert"]'
      );
      for (const modal of modals) {
        checkNode(modal);
      }
    } catch (_) { /* ignore DOM errors */ }
  }, 10000);
})();
`;
}

// ── Core functions ───────────────────────────────────────────

function loadWarnings() {
  try {
    if (fs.existsSync(warningsPath)) {
      warnings = JSON.parse(fs.readFileSync(warningsPath, 'utf8'));
    }
  } catch (e) {
    console.error('[whatsapp-monitor] Failed to load warnings:', e.message);
    warnings = {};
  }
}

function saveWarnings() {
  try {
    fs.writeFileSync(warningsPath, JSON.stringify(warnings, null, 2), 'utf8');
  } catch (e) {
    console.error('[whatsapp-monitor] Failed to save warnings:', e.message);
  }
}

function pruneOldWarnings() {
  const cutoff = Date.now() - WARNING_TTL;
  for (const accountId of Object.keys(warnings)) {
    warnings[accountId] = (warnings[accountId] || []).filter(
      (w) => new Date(w.timestamp).getTime() > cutoff
    );
    if (warnings[accountId].length === 0) {
      delete warnings[accountId];
    }
  }
  saveWarnings();
}

function addWarning(accountId, warning) {
  if (!warnings[accountId]) {
    warnings[accountId] = [];
  }
  warnings[accountId].push(warning);
  pruneOldWarnings();
  saveWarnings();
  console.log(`[whatsapp-monitor] Warning for account ${accountId}: ${warning.text}`);
}

function getRecentWarningCount(accountId) {
  const cutoff = Date.now() - WARNING_TTL;
  return (warnings[accountId] || []).filter(
    (w) => new Date(w.timestamp).getTime() > cutoff
  ).length;
}

// ── Injection into WebViews ──────────────────────────────────

function injectMonitorIntoView(accountId, view) {
  if (!view || !view.webContents || view.webContents.isDestroyed()) return;

  const script = buildInjectedScript();
  view.webContents.executeJavaScript(script).catch((err) => {
    console.error(`[whatsapp-monitor] Injection failed for ${accountId}:`, err.message);
  });

  // Listen for warnings posted via window.postMessage -> preload -> ipc-message
  // We use the 'ipc-message' event on webContents, which fires when the preload
  // calls ipcRenderer.sendToHost(). However, since the injected script uses
  // window.postMessage, we also need to handle that via a content-script bridge.
  // Inject a small bridge that forwards postMessage events to sendToHost.
  const bridge = `
(function() {
  if (window.__SUPAMSG_BRIDGE_ACTIVE__) return;
  window.__SUPAMSG_BRIDGE_ACTIVE__ = true;
  window.addEventListener('message', (event) => {
    if (event.data && event.data.type === 'supamsg-whatsapp-warning') {
      // Use the electronAPI exposed by preload, or fallback to postMessage relay
      try {
        const { ipcRenderer } = require('electron');
        ipcRenderer.sendToHost('supamsg-whatsapp-warning', event.data.payload);
      } catch (_) {
        // If contextIsolation is on, we cannot require electron here.
        // The preload script must pick this up.
      }
    }
  });
})();
`;

  // Since contextIsolation is true, the bridge above won't work from
  // executeJavaScript. Instead we rely on the preload to forward the message.
  // We set up the webContents ipc-message listener to catch it.
  setupViewListener(accountId, view);
}

function setupViewListener(accountId, view) {
  if (!view || !view.webContents || view.webContents.isDestroyed()) return;

  // Avoid duplicate listeners by tagging the webContents
  if (view.webContents.__supamsgMonitorListening) return;
  view.webContents.__supamsgMonitorListening = true;

  view.webContents.on('ipc-message', (_event, channel, data) => {
    if (channel === 'supamsg-whatsapp-warning') {
      handleWarning(accountId, data);
    }
  });
}

function handleWarning(accountId, data) {
  const warning = {
    type: data.type || 'whatsapp-warning',
    text: data.text || 'Unknown warning',
    pattern: data.pattern || 'unknown',
    timestamp: data.timestamp || new Date().toISOString(),
  };

  addWarning(accountId, warning);

  // Notify the renderer (main window UI)
  try {
    const mainWindow = getMainWindowRef();
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('whatsapp-warning', {
        accountId,
        warning,
      });
    }
  } catch (_) { /* window may not be ready */ }

  // Emit event for smart-outreach integration
  try {
    if (ipcMainRef) {
      ipcMainRef.emit('outreach-account-warning', {
        accountId,
        warning,
        recentCount: getRecentWarningCount(accountId),
      });
    }
  } catch (_) { /* safe guard */ }
}

function injectMonitorsIntoAllViews() {
  const views = getViewsRef();
  if (!views) return;

  for (const accountId of Object.keys(views)) {
    injectMonitorIntoView(accountId, views[accountId]);
  }
}

// ── Check for replies (used by smart-outreach) ──────────────

async function checkForReplies(view, contactName) {
  if (!view || !view.webContents || view.webContents.isDestroyed()) {
    return { replied: false, lastMessageText: '' };
  }

  try {
    const result = await view.webContents.executeJavaScript(`
(function() {
  try {
    // Multiple selector strategies for finding and opening a contact's chat
    const searchSelectors = [
      '[data-testid="chat-list-search"]',
      '[contenteditable="true"][data-tab="3"]',
      'div[role="textbox"][data-tab="3"]',
      '#side [contenteditable="true"]',
    ];

    // Try to find messages in the currently open chat
    // First check if the right contact is already open
    const headerSelectors = [
      '[data-testid="conversation-header"] span[title]',
      '#main header span[title]',
      'header span[dir="auto"][title]',
    ];

    let currentContact = '';
    for (const sel of headerSelectors) {
      const el = document.querySelector(sel);
      if (el) {
        currentContact = (el.getAttribute('title') || el.textContent || '').trim();
        break;
      }
    }

    const contactName = ${JSON.stringify(contactName)};
    const isCorrectChat = currentContact.toLowerCase().includes(contactName.toLowerCase()) ||
                          contactName.toLowerCase().includes(currentContact.toLowerCase());

    if (!isCorrectChat) {
      return { replied: false, lastMessageText: '', reason: 'wrong-chat' };
    }

    // Find the last message in the conversation
    const messageSelectors = [
      '[data-testid="msg-container"]',
      '.message-in, .message-out',
      'div[class*="message"]',
    ];

    let messages = [];
    for (const sel of messageSelectors) {
      messages = document.querySelectorAll(sel);
      if (messages.length > 0) break;
    }

    if (messages.length === 0) {
      return { replied: false, lastMessageText: '', reason: 'no-messages' };
    }

    const lastMsg = messages[messages.length - 1];
    const classList = Array.from(lastMsg.classList || []);
    const testId = lastMsg.getAttribute('data-testid') || '';

    // Determine if the last message is incoming
    // Incoming messages typically have 'message-in' class or lack 'message-out'
    const isIncoming = classList.some(c => c.includes('message-in')) ||
                       testId.includes('msg-container') && !lastMsg.querySelector('[data-testid="msg-dblcheck"]') ||
                       !classList.some(c => c.includes('message-out'));

    // Extract text from the last message
    const textSelectors = [
      '[data-testid="msg-text"] span',
      '.selectable-text span',
      'span.selectable-text',
      'span[dir="ltr"]',
    ];

    let lastMessageText = '';
    for (const sel of textSelectors) {
      const el = lastMsg.querySelector(sel);
      if (el && el.textContent) {
        lastMessageText = el.textContent.trim().substring(0, 500);
        break;
      }
    }

    return {
      replied: isIncoming,
      lastMessageText: lastMessageText,
    };
  } catch (e) {
    return { replied: false, lastMessageText: '', error: e.message };
  }
})();
    `);

    return result || { replied: false, lastMessageText: '' };
  } catch (err) {
    console.error('[whatsapp-monitor] checkForReplies error:', err.message);
    return { replied: false, lastMessageText: '', error: err.message };
  }
}

// ── Init ─────────────────────────────────────────────────────

function initWhatsAppMonitor({ app, ipcMain, getMainWindow, getViews, getAccounts }) {
  appRef = app;
  ipcMainRef = ipcMain;
  getMainWindowRef = getMainWindow;
  getViewsRef = getViews;
  getAccountsRef = getAccounts;

  warningsPath = path.join(app.getPath('userData'), 'whatsapp-warnings.json');
  loadWarnings();
  pruneOldWarnings();

  // ── IPC Handlers ─────────────────────────────────────────

  ipcMain.handle('get-account-warnings', (_event, accountId) => {
    pruneOldWarnings();
    if (accountId) {
      return warnings[accountId] || [];
    }
    return warnings;
  });

  ipcMain.handle('clear-account-warnings', (_event, accountId) => {
    if (accountId) {
      delete warnings[accountId];
    } else {
      warnings = {};
    }
    saveWarnings();
    return { success: true };
  });

  ipcMain.on('inject-monitors', () => {
    injectMonitorsIntoAllViews();
  });

  // ── Auto-inject on view creation / reload ────────────────

  // Periodically check for new or reloaded views and inject monitors
  setInterval(() => {
    try {
      const views = getViews();
      if (!views) return;
      for (const accountId of Object.keys(views)) {
        const view = views[accountId];
        if (view && view.webContents && !view.webContents.isDestroyed()) {
          // Re-inject if the flag was lost (e.g. page reload)
          view.webContents.executeJavaScript('!!window.__SUPAMSG_MONITOR_ACTIVE__')
            .then((active) => {
              if (!active) {
                injectMonitorIntoView(accountId, view);
              }
            })
            .catch(() => {
              // Page may not be ready yet, skip
            });
        }
      }
    } catch (_) { /* safe guard */ }
  }, 15000);

  // Initial injection after a short delay to let views load
  setTimeout(() => {
    injectMonitorsIntoAllViews();
  }, 5000);

  // Prune old warnings every hour
  setInterval(pruneOldWarnings, 60 * 60 * 1000);

  console.log('[whatsapp-monitor] Initialized');
}

// ── Exports ──────────────────────────────────────────────────

module.exports = { initWhatsAppMonitor, checkForReplies };
