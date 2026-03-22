const fs = require('fs');
const path = require('path');
const uuidv4 = () => require('crypto').randomUUID();
const { BrowserView } = require('electron');

function initCrossMessenger({ app, ipcMain, getMainWindow, getViews, getActiveAccountId, getAccounts }) {
  const configPath = path.join(app.getPath('userData'), 'messenger-accounts.json');

  const SUPPORTED_MESSENGERS = {
    whatsapp: {
      type: 'whatsapp',
      name: 'WhatsApp',
      url: 'https://web.whatsapp.com',
      icon: 'whatsapp',
    },
    telegram: {
      type: 'telegram',
      name: 'Telegram',
      url: 'https://web.telegram.org/k/',
      icon: 'telegram',
    },
    signal: {
      type: 'signal',
      name: 'Signal',
      url: null, // Signal Desktop needed, not web-based
      icon: 'signal',
      note: 'Signal requires the Signal Desktop app. Web version not available.',
    },
    instagram: {
      type: 'instagram',
      name: 'Instagram',
      url: 'https://www.instagram.com/direct/inbox/',
      icon: 'instagram',
    },
  };

  const DESKTOP_USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

  let accounts = [];
  let messengerViews = {};

  // --- ID generation ---

  function generateId() {
    try {
      return uuidv4();
    } catch {
      return `msg-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
    }
  }

  // --- Persistence ---

  function loadAccounts() {
    try {
      if (fs.existsSync(configPath)) {
        accounts = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
      }
    } catch (err) {
      console.error('[cross-messenger] Failed to load accounts:', err);
      accounts = [];
    }
  }

  function saveAccounts() {
    try {
      fs.writeFileSync(configPath, JSON.stringify(accounts, null, 2), 'utf-8');
    } catch (err) {
      console.error('[cross-messenger] Failed to save accounts:', err);
    }
  }

  // --- BrowserView Management ---

  function createMessengerView(account) {
    const messenger = SUPPORTED_MESSENGERS[account.type];
    if (!messenger || !messenger.url) {
      console.warn(`[cross-messenger] Cannot create view for ${account.type}: no URL available`);
      return null;
    }

    const view = new BrowserView({
      webPreferences: {
        partition: `persist:messenger-${account.id}`,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    });

    view.webContents.setUserAgent(DESKTOP_USER_AGENT);
    view.webContents.loadURL(account.url);

    // Intercept notifications
    view.webContents.on('notification', (event, title, body) => {
      const win = getMainWindow();
      if (win) {
        win.webContents.send('messenger-notification', {
          accountId: account.id,
          type: account.type,
          title,
          body,
        });
      }
    });

    messengerViews[account.id] = view;
    return view;
  }

  function destroyMessengerView(accountId) {
    const view = messengerViews[accountId];
    if (view) {
      const win = getMainWindow();
      if (win) {
        try {
          win.removeBrowserView(view);
        } catch {
          // View may not be attached
        }
      }
      view.webContents.destroy();
      delete messengerViews[accountId];
    }
  }

  // --- IPC Handlers ---

  ipcMain.handle('get-messenger-accounts', () => {
    return accounts.map((a) => ({ ...a }));
  });

  ipcMain.on('add-messenger-account', (event, { type, name }) => {
    const messenger = SUPPORTED_MESSENGERS[type];
    if (!messenger) {
      console.error(`[cross-messenger] Unsupported messenger type: ${type}`);
      return;
    }

    if (!messenger.url) {
      console.warn(`[cross-messenger] ${type} does not support web-based access.`);
      const win = getMainWindow();
      if (win) {
        win.webContents.send('messenger-error', {
          type,
          message: messenger.note || `${type} web access not available.`,
        });
      }
      return;
    }

    const account = {
      id: generateId(),
      type,
      name: name || messenger.name,
      color: type === 'whatsapp' ? '#25D366' : type === 'telegram' ? '#0088cc' : type === 'instagram' ? '#E1306C' : '#3A76F0',
      url: messenger.url,
    };

    accounts.push(account);
    saveAccounts();
    createMessengerView(account);

    const win = getMainWindow();
    if (win) {
      win.webContents.send('messenger-account-added', account);
    }
  });

  ipcMain.on('remove-messenger-account', (event, { id }) => {
    const index = accounts.findIndex((a) => a.id === id);
    if (index === -1) return;

    destroyMessengerView(id);
    accounts.splice(index, 1);
    saveAccounts();

    const win = getMainWindow();
    if (win) {
      win.webContents.send('messenger-account-removed', { id });
    }
  });

  ipcMain.handle('get-supported-messengers', () => {
    return Object.values(SUPPORTED_MESSENGERS).map((m) => ({
      type: m.type,
      name: m.name,
      icon: m.icon,
      available: !!m.url,
      note: m.note || null,
    }));
  });

  // --- Init ---

  loadAccounts();
}

module.exports = { initCrossMessenger };
