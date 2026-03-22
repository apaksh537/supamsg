// Stealth Mode: read receipt control per account
// Injects CSS/JS into WhatsApp Web to block read receipt signals

const path = require('path');
const fs = require('fs');

let stealthPath;
let stealthSettings = {}; // accountId -> { readReceipts: false, typing: false, online: false }

function initStealthMode({ app, ipcMain, getViews }) {
  stealthPath = path.join(app.getPath('userData'), 'stealth.json');
  loadSettings();

  ipcMain.handle('get-stealth-settings', () => stealthSettings);

  ipcMain.on('update-stealth', (_event, { accountId, settings }) => {
    stealthSettings[accountId] = { ...stealthSettings[accountId], ...settings };
    saveSettings();
    applyStealthMode(accountId, getViews());
  });

  // Apply stealth mode when views are created
  ipcMain.on('apply-stealth-all', () => {
    const views = getViews();
    for (const accountId of Object.keys(views)) {
      applyStealthMode(accountId, views);
    }
  });
}

function applyStealthMode(accountId, views) {
  const view = views[accountId];
  if (!view) return;

  const s = stealthSettings[accountId] || {};

  // Inject stealth CSS/JS
  view.webContents.executeJavaScript(`
    (function() {
      // Remove existing stealth styles
      const existing = document.getElementById('whatsapp-hub-stealth');
      if (existing) existing.remove();

      const style = document.createElement('style');
      style.id = 'whatsapp-hub-stealth';
      let css = '';

      // Hide blue ticks (read receipts) — makes them look like grey (delivered)
      ${s.readReceipts === false ? `
      css += '[data-testid="msg-dblcheck-ack"] { color: rgba(255,255,255,0.5) !important; }';
      css += '[data-icon="msg-dblcheck-ack"] path { fill: rgba(255,255,255,0.5) !important; }';
      ` : ''}

      style.textContent = css;
      document.head.appendChild(style);

      // Block read receipt network requests
      ${s.readReceipts === false ? `
      // Intercept XMLHttpRequest to block read receipt pings
      if (!window._hubOrigXHR) {
        window._hubOrigXHR = window.XMLHttpRequest.prototype.send;
        window.XMLHttpRequest.prototype.send = function(body) {
          if (body && typeof body === 'string' && body.includes('read')) {
            // Silently drop read receipt
            return;
          }
          return window._hubOrigXHR.apply(this, arguments);
        };
      }
      ` : `
      // Restore original XHR if stealth was disabled
      if (window._hubOrigXHR) {
        window.XMLHttpRequest.prototype.send = window._hubOrigXHR;
        delete window._hubOrigXHR;
      }
      `}

      // Block typing indicator
      ${s.typing === false ? `
      // Override typing event dispatching
      if (!window._hubTypingBlocked) {
        window._hubTypingBlocked = true;
        const origDispatch = EventTarget.prototype.dispatchEvent;
        EventTarget.prototype.dispatchEvent = function(event) {
          if (event.type === 'composing' || event.type === 'paused') return true;
          return origDispatch.apply(this, arguments);
        };
      }
      ` : ''}

      // Block online presence
      ${s.online === false ? `
      if (!window._hubPresenceBlocked) {
        window._hubPresenceBlocked = true;
        Object.defineProperty(document, 'visibilityState', { value: 'hidden', writable: false });
        Object.defineProperty(document, 'hidden', { value: true, writable: false });
      }
      ` : ''}

      return true;
    })();
  `).catch(() => {});
}

// Called from main.js after a view finishes loading
function applyStealthToView(accountId, views) {
  if (stealthSettings[accountId]) {
    setTimeout(() => applyStealthMode(accountId, views), 2000);
  }
}

function loadSettings() {
  try {
    if (fs.existsSync(stealthPath)) {
      stealthSettings = JSON.parse(fs.readFileSync(stealthPath, 'utf8'));
    }
  } catch (e) {
    stealthSettings = {};
  }
}

function saveSettings() {
  fs.writeFileSync(stealthPath, JSON.stringify(stealthSettings, null, 2));
}

module.exports = { initStealthMode, applyStealthToView };
