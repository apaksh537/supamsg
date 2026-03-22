const {
  app,
  BrowserWindow,
  BrowserView,
  ipcMain,
  session,
  Notification,
  Tray,
  Menu,
  nativeImage,
  globalShortcut,
  shell,
  dialog,
} = require('electron');
const path = require('path');
const fs = require('fs');

// Feature modules
const { initSplitScreen } = require('./features/split-screen');
const { initScheduledMessages, cleanup: cleanupScheduler } = require('./features/scheduled-messages');
const { initTemplates } = require('./features/templates');
const { initChatExport } = require('./features/chat-export');
const { initContactLabels } = require('./features/contact-labels');
const { initAnalytics, recordActivity } = require('./features/analytics');
const { initAiReplies } = require('./features/ai-replies');
const { initAutomations, checkAutomationTriggers } = require('./features/automations');
const { initBroadcast } = require('./features/broadcast');
const { initStealthMode, applyStealthToView } = require('./features/stealth-mode');
const { initCrmIntegration } = require('./features/crm-integration');
const { initLicensing } = require('./features/licensing');
const { initMobileRelay, broadcastNotification } = require('./features/mobile-relay');
const { initAutoUpdater } = require('./features/auto-updater');

// New feature modules (30 features)
const { initConversationKanban } = require('./features/conversation-kanban');
const { initSmartNotifications } = require('./features/smart-notifications');
const { initQuickActions } = require('./features/quick-actions');
const { initVoiceTranscription } = require('./features/voice-transcription');
const { initMessageRecall } = require('./features/message-recall');
const { initCollaborativeNotes } = require('./features/collaborative-notes');
const { initTimezoneScheduler } = require('./features/timezone-scheduler');
const { initSentimentAlerts, analyzeSentiment } = require('./features/sentiment-alerts');
const { initPaymentCollection } = require('./features/payment-collection');
const { initProductCatalog } = require('./features/product-catalog');
const { initAppointmentBooking } = require('./features/appointment-booking');
const { initStatusManager } = require('./features/status-manager');
const { initChatbotBuilder, processBotMessage } = require('./features/chatbot-builder');
const { initChatBackup } = require('./features/chat-backup');
const { initWebhookApi } = require('./features/webhook-api');
const { initAiInsights } = require('./features/ai-insights');
const { initEcommerceTracking } = require('./features/ecommerce-tracking');
const { initAiAgent, processAgentMessage } = require('./features/ai-agent');
const { initZapierIntegration } = require('./features/zapier-integration');
const { initWhiteLabel } = require('./features/white-label');
const { initCrossMessenger } = require('./features/cross-messenger');
const { initScreenMirror } = require('./features/screen-mirror');
const { initVirtualNumbers } = require('./features/virtual-numbers');
const { initSmsBridge } = require('./features/sms-bridge');
const { initTeamInbox } = require('./features/team-inbox');
const { initAdvancedAnalytics } = require('./features/advanced-analytics');
const { initAutoTranslate } = require('./features/auto-translate');
const { initCustomDashboard } = require('./features/custom-dashboard');
const { initWhatsappBusinessApi } = require('./features/whatsapp-business-api');
const { initConversationSearch } = require('./features/conversation-search');
const { initPosthogAnalytics, trackEvent } = require('./features/posthog-analytics');

const DATA_PATH = path.join(app.getPath('userData'), 'accounts.json');
const SETTINGS_PATH = path.join(app.getPath('userData'), 'settings.json');
const ONBOARDING_PATH = path.join(app.getPath('userData'), 'onboarded.flag');
const WHATSAPP_URL = 'https://web.whatsapp.com';

let mainWindow;
let onboardingWindow;
let tray;
let accounts = [];
let activeAccountId = null;
let views = {};
let unreadCounts = {};
let splitScreen;

let settings = {
  notifications: true,
  notificationSound: true,
  dnd: false,
  dndSchedule: null,
  launchAtLogin: false,
  globalShortcut: 'CommandOrControl+Shift+W',
  sidebarCollapsed: false,
};

// ── Helpers for feature modules ──────────────────────────────

const getMainWindow = () => mainWindow;
const getViews = () => views;
const getAccounts = () => accounts;
const getActiveAccountId = () => activeAccountId;
const getSidebarWidth = () => (settings.sidebarCollapsed ? 60 : 220);

// ── Persistence ──────────────────────────────────────────────

function loadAccounts() {
  try {
    if (fs.existsSync(DATA_PATH)) {
      accounts = JSON.parse(fs.readFileSync(DATA_PATH, 'utf8'));
    }
  } catch (e) {
    accounts = [];
  }
  if (accounts.length === 0) {
    accounts = [
      { id: 'account-1', name: 'WhatsApp 1', color: '#25D366' },
      { id: 'account-2', name: 'WhatsApp 2', color: '#128C7E' },
    ];
    saveAccounts();
  }
}

function saveAccounts() {
  fs.writeFileSync(DATA_PATH, JSON.stringify(accounts, null, 2));
}

function loadSettings() {
  try {
    if (fs.existsSync(SETTINGS_PATH)) {
      settings = { ...settings, ...JSON.parse(fs.readFileSync(SETTINGS_PATH, 'utf8')) };
    }
  } catch (e) {}
}

function saveSettings() {
  fs.writeFileSync(SETTINGS_PATH, JSON.stringify(settings, null, 2));
}

// ── DND Logic ────────────────────────────────────────────────

function isDndActive() {
  if (!settings.dnd) return false;
  if (!settings.dndSchedule) return true;
  const now = new Date();
  const hhmm = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
  const { start, end } = settings.dndSchedule;
  if (start <= end) return hhmm >= start && hhmm < end;
  return hhmm >= start || hhmm < end;
}

// ── Notifications ────────────────────────────────────────────

function showNotification(accountId, title, body) {
  if (!settings.notifications || isDndActive()) return;
  const account = accounts.find((a) => a.id === accountId);
  const accountName = account ? account.name : 'WhatsApp';

  const notif = new Notification({
    title: `${accountName}: ${title}`,
    body: body || '',
    silent: !settings.notificationSound,
  });

  notif.on('click', () => {
    if (mainWindow) {
      mainWindow.show();
      mainWindow.focus();
      switchToAccount(accountId);
    }
  });

  notif.show();
}

function updateDockBadge() {
  const total = Object.values(unreadCounts).reduce((sum, n) => sum + n, 0);
  if (app.dock) app.dock.setBadge(total > 0 ? String(total) : '');
  if (tray) tray.setToolTip(total > 0 ? `SupaMsg (${total} unread)` : 'SupaMsg');
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('unread-counts', unreadCounts);
  }
}

// ── BrowserView per account ──────────────────────────────────

function createViewForAccount(account) {
  const partition = `persist:${account.id}`;
  const ses = session.fromPartition(partition);

  ses.setUserAgent(
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
  );

  ses.setPermissionRequestHandler((_wc, permission, callback) => {
    callback(permission === 'notifications' || permission === 'media');
  });

  const view = new BrowserView({
    webPreferences: {
      partition,
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(__dirname, 'preload-whatsapp.js'),
    },
  });

  view.webContents.loadURL(WHATSAPP_URL);

  view.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  // Track unread from title changes: "(3) WhatsApp"
  view.webContents.on('page-title-updated', (_event, title) => {
    const match = title.match(/^\((\d+)\)/);
    const count = match ? parseInt(match[1], 10) : 0;
    const prevCount = unreadCounts[account.id] || 0;
    unreadCounts[account.id] = count;
    updateDockBadge();

    // Analytics + Automations: record when new messages arrive
    if (count > prevCount) {
      recordActivity(account.id, count - prevCount);
      // Trigger automation checks (message text unknown from title, pass null)
      try { checkAutomationTriggers(account.id, null, null); } catch (e) {}
    }

    if (count > prevCount && (activeAccountId !== account.id || !mainWindow.isFocused())) {
      showNotification(account.id, 'New message', `${count} unread message${count > 1 ? 's' : ''}`);
    }
  });

  // Inject Notification API interceptor
  view.webContents.on('did-finish-load', () => {
    view.webContents.executeJavaScript(`
      (function() {
        const OrigNotification = window.Notification;
        window.Notification = function(title, options) {
          window.postMessage({ type: 'wa-notification', title, body: options?.body || '' }, '*');
          return new OrigNotification(title, options);
        };
        window.Notification.permission = 'granted';
        window.Notification.requestPermission = () => Promise.resolve('granted');
      })();
    `);

    // Apply stealth mode if configured
    applyStealthToView(account.id, views);
  });

  views[account.id] = view;
  return view;
}

// ── View management ──────────────────────────────────────────

function switchToAccount(accountId) {
  if (!mainWindow) return;

  // Exit split screen if active
  if (splitScreen && splitScreen.isSplit()) {
    const { leftId, rightId } = splitScreen.getSplitIds();
    if (leftId && views[leftId]) mainWindow.removeBrowserView(views[leftId]);
    if (rightId && views[rightId]) mainWindow.removeBrowserView(views[rightId]);
    splitScreen.exitSplit();
    mainWindow.webContents.send('split-screen-changed', { active: false });
  }

  if (activeAccountId && views[activeAccountId]) {
    mainWindow.removeBrowserView(views[activeAccountId]);
  }

  const view = views[accountId];
  if (view) {
    mainWindow.addBrowserView(view);
    resizeView(view);
    activeAccountId = accountId;
    mainWindow.webContents.send('account-switched', accountId);
  }
}

function resizeView(view) {
  if (!mainWindow || !view) return;
  const contentBounds = mainWindow.getContentBounds();
  const windowBounds = mainWindow.getBounds();
  // Content bounds gives us the actual usable area (excludes title bar chrome)
  const contentWidth = contentBounds.width;
  const contentHeight = contentBounds.height;
  const tabBarHeight = 40; // Account tab bar at top

  const mode = settings.uiMode || 'whatsapp';
  let x = 0, y = tabBarHeight;
  let w = contentWidth;
  let h = contentHeight - tabBarHeight;

  if (mode === 'simple' || mode === 'pro') {
    const sidebarWidth = getSidebarWidth();
    x = sidebarWidth;
    w = contentWidth - sidebarWidth;
  }

  view.setBounds({ x, y, width: Math.max(w, 0), height: Math.max(h, 0) });
  view.setAutoResize({ width: true, height: true });
}

function resizeAllViews() {
  if (splitScreen && splitScreen.isSplit()) {
    splitScreen.resizeSplit(mainWindow, views, getSidebarWidth());
  } else if (activeAccountId && views[activeAccountId]) {
    resizeView(views[activeAccountId]);
  }
}

// ── System Tray ──────────────────────────────────────────────

function createTray() {
  // Use template image for native macOS tray appearance (monochrome, adapts to dark/light mode)
  const iconPath = path.join(__dirname, 'build', 'trayTemplate.png');
  let icon = nativeImage.createFromPath(iconPath);
  icon.setTemplateImage(true);
  tray = new Tray(icon);
  tray.setToolTip('SupaMsg');
  tray.on('click', () => {
    if (mainWindow) mainWindow.isVisible() ? mainWindow.hide() : mainWindow.show();
  });
  updateTrayMenu();
}

function updateTrayMenu() {
  if (!tray) return;
  const accountItems = accounts.map((acc) => ({
    label: `${acc.name}${unreadCounts[acc.id] ? ` (${unreadCounts[acc.id]})` : ''}`,
    click: () => { mainWindow.show(); switchToAccount(acc.id); },
  }));

  const menu = Menu.buildFromTemplate([
    { label: 'Show SupaMsg', click: () => mainWindow.show() },
    { type: 'separator' },
    ...accountItems,
    { type: 'separator' },
    {
      label: isDndActive() ? 'Disable Do Not Disturb' : 'Enable Do Not Disturb',
      click: () => {
        settings.dnd = !settings.dnd;
        saveSettings();
        updateTrayMenu();
        mainWindow.webContents.send('settings-updated', settings);
      },
    },
    { type: 'separator' },
    { label: 'Quit', click: () => app.quit() },
  ]);
  tray.setContextMenu(menu);
}

// ── Onboarding ───────────────────────────────────────────────

function showOnboarding() {
  return new Promise((resolve) => {
    let resolved = false;
    function resolveOnce() {
      if (!resolved) {
        resolved = true;
        resolve();
      }
    }

    onboardingWindow = new BrowserWindow({
      width: 700,
      height: 560,
      resizable: false,
      titleBarStyle: 'hiddenInset',
      backgroundColor: '#1a1a2e',
      webPreferences: {
        preload: path.join(__dirname, 'preload-onboarding.js'),
        contextIsolation: true,
        nodeIntegration: false,
      },
    });

    onboardingWindow.loadFile('onboarding.html');

    ipcMain.once('finish-onboarding', () => {
      fs.writeFileSync(ONBOARDING_PATH, '1');
      onboardingWindow.close();
      onboardingWindow = null;
      resolveOnce();
    });

    onboardingWindow.on('closed', () => {
      fs.writeFileSync(ONBOARDING_PATH, '1');
      onboardingWindow = null;
      resolveOnce();
    });
  });
}

// ── Main Window ──────────────────────────────────────────────

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 800,
    minHeight: 600,
    title: 'SupaMsg',
    titleBarStyle: 'hiddenInset',
    backgroundColor: '#1a1a2e',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.loadFile('index.html');

  mainWindow.on('close', (e) => {
    if (!app.isQuitting) {
      e.preventDefault();
      mainWindow.hide();
    }
  });

  mainWindow.on('resize', resizeAllViews);

  mainWindow.webContents.on('did-finish-load', () => {
    mainWindow.webContents.send('load-accounts', accounts);
    mainWindow.webContents.send('settings-updated', settings);
    mainWindow.webContents.send('unread-counts', unreadCounts);

    for (const account of accounts) {
      createViewForAccount(account);
    }

    if (accounts.length > 0) {
      switchToAccount(accounts[0].id);
    }

    // Monitor memory usage
    setInterval(() => {
      const memUsage = process.memoryUsage();
      const heapUsedMB = Math.round(memUsage.heapUsed / 1024 / 1024);
      const rssMB = Math.round(memUsage.rss / 1024 / 1024);
      if (rssMB > 2000) { // Over 2GB
        mainWindow.webContents.send('memory-warning', { rssMB, heapUsedMB, accounts: Object.keys(views).length });
      }
    }, 60000); // Check every minute
  });
}

// ── IPC handlers ─────────────────────────────────────────────

// Hide/show all BrowserViews so panel overlays are visible
ipcMain.on('hide-views', () => {
  for (const view of Object.values(views)) {
    try { mainWindow.removeBrowserView(view); } catch (e) {}
  }
});

ipcMain.on('show-views', () => {
  // Re-add only the active view (or split views)
  if (splitScreen && splitScreen.isSplit()) {
    const { leftId, rightId } = splitScreen.getSplitIds();
    if (leftId && views[leftId]) { mainWindow.addBrowserView(views[leftId]); }
    if (rightId && views[rightId]) { mainWindow.addBrowserView(views[rightId]); }
    splitScreen.resizeSplit(mainWindow, views, getSidebarWidth());
  } else if (activeAccountId && views[activeAccountId]) {
    mainWindow.addBrowserView(views[activeAccountId]);
    resizeView(views[activeAccountId]);
  }
});

// Native prompt dialog (works reliably in Electron)
ipcMain.handle('show-prompt', async (_event, { title, message, defaultValue }) => {
  // Temporarily hide views so user can see the main window context
  for (const view of Object.values(views)) {
    try { mainWindow.removeBrowserView(view); } catch (e) {}
  }

  const { response, checkboxChecked } = await dialog.showMessageBox(mainWindow, {
    type: 'question',
    title: title || 'SupaMsg',
    message: title || '',
    detail: message || '',
    buttons: ['Cancel', 'OK'],
    defaultId: 1,
    cancelId: 0,
  });

  // This is a message box, not an input dialog. Electron doesn't have native input dialogs.
  // So we'll use a different approach: a small BrowserWindow as input dialog.
  // For now, restore views.
  if (splitScreen && splitScreen.isSplit()) {
    const { leftId, rightId } = splitScreen.getSplitIds();
    if (leftId && views[leftId]) mainWindow.addBrowserView(views[leftId]);
    if (rightId && views[rightId]) mainWindow.addBrowserView(views[rightId]);
    splitScreen.resizeSplit(mainWindow, views, getSidebarWidth());
  } else if (activeAccountId && views[activeAccountId]) {
    mainWindow.addBrowserView(views[activeAccountId]);
    resizeView(views[activeAccountId]);
  }

  return response === 1; // true if OK
});

// Input dialog using a child BrowserWindow
ipcMain.handle('show-input-dialog', async (_event, { title, message, placeholder, defaultValue }) => {
  return new Promise((resolve) => {
    const inputWin = new BrowserWindow({
      width: 400,
      height: 220,
      parent: mainWindow,
      modal: true,
      resizable: false,
      minimizable: false,
      maximizable: false,
      titleBarStyle: 'hiddenInset',
      backgroundColor: '#1a1a2e',
      webPreferences: {
        contextIsolation: false,
        nodeIntegration: true,
      },
    });

    const escapedTitle = (title || '').replace(/'/g, "\\'");
    const escapedMsg = (message || '').replace(/'/g, "\\'");
    const escapedPlaceholder = (placeholder || '').replace(/'/g, "\\'");
    const escapedDefault = (defaultValue || '').replace(/'/g, "\\'");

    inputWin.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(`<!DOCTYPE html>
<html><head><style>
  * { margin:0; padding:0; box-sizing:border-box; }
  body { font-family:-apple-system,BlinkMacSystemFont,sans-serif; background:#1a1a2e; color:#e0e0e0; padding:40px 24px 24px; -webkit-app-region:drag; }
  h2 { font-size:18px; color:#25D366; margin-bottom:8px; }
  p { font-size:13px; color:#a0a0c0; margin-bottom:16px; }
  input { width:100%; padding:10px 14px; background:rgba(255,255,255,0.06); border:1px solid rgba(255,255,255,0.15); border-radius:8px; color:#e0e0e0; font-size:14px; outline:none; -webkit-app-region:no-drag; }
  input:focus { border-color:#25D366; }
  .btns { display:flex; gap:8px; justify-content:flex-end; margin-top:16px; -webkit-app-region:no-drag; }
  button { padding:8px 20px; border-radius:6px; border:none; font-size:13px; font-weight:600; cursor:pointer; }
  .cancel { background:rgba(255,255,255,0.1); color:#e0e0e0; }
  .ok { background:#25D366; color:#000; }
</style></head><body>
  <h2>${escapedTitle}</h2>
  <p>${escapedMsg}</p>
  <input id="inp" placeholder="${escapedPlaceholder}" value="${escapedDefault}" autofocus>
  <div class="btns">
    <button class="cancel" onclick="require('electron').ipcRenderer.send('input-dialog-result',null);window.close()">Cancel</button>
    <button class="ok" onclick="submit()">OK</button>
  </div>
  <script>
    const inp = document.getElementById('inp');
    inp.focus();
    inp.select();
    function submit() {
      require('electron').ipcRenderer.send('input-dialog-result', inp.value);
      window.close();
    }
    inp.addEventListener('keydown', e => { if(e.key==='Enter') submit(); if(e.key==='Escape') { require('electron').ipcRenderer.send('input-dialog-result',null); window.close(); }});
  </script>
</body></html>`)}`);

    const handler = (_e, value) => {
      resolve(value);
      ipcMain.removeListener('input-dialog-result', handler);
    };
    ipcMain.on('input-dialog-result', handler);

    inputWin.on('closed', () => {
      ipcMain.removeListener('input-dialog-result', handler);
      resolve(null);
    });
  });
});

// Confirm dialog using native Electron dialog
ipcMain.handle('show-confirm-dialog', async (_event, { title, message }) => {
  const { response } = await dialog.showMessageBox(mainWindow, {
    type: 'warning',
    title: title || 'Confirm',
    message: title || 'Confirm',
    detail: message || '',
    buttons: ['Cancel', 'Yes'],
    defaultId: 1,
    cancelId: 0,
  });
  return response === 1;
});

ipcMain.on('switch-account', (_event, accountId) => switchToAccount(accountId));

ipcMain.on('add-account', (_event, name) => {
  const id = `account-${Date.now()}`;
  const colors = ['#25D366', '#128C7E', '#075E54', '#34B7F1', '#ECE5DD', '#DCF8C6'];
  const color = colors[accounts.length % colors.length];
  const account = { id, name, color };
  accounts.push(account);
  saveAccounts();
  createViewForAccount(account);
  mainWindow.webContents.send('load-accounts', accounts);
  switchToAccount(id);
  updateTrayMenu();
  trackEvent('account_added', { accountCount: accounts.length });
});

ipcMain.on('rename-account', (_event, { id, name }) => {
  const account = accounts.find((a) => a.id === id);
  if (account) {
    account.name = name;
    saveAccounts();
    mainWindow.webContents.send('load-accounts', accounts);
    updateTrayMenu();
  }
});

ipcMain.on('remove-account', (_event, accountId) => {
  if (views[accountId]) {
    mainWindow.removeBrowserView(views[accountId]);
    views[accountId].webContents.close();
    delete views[accountId];
  }
  const partition = `persist:${accountId}`;
  session.fromPartition(partition).clearStorageData();
  delete unreadCounts[accountId];

  accounts = accounts.filter((a) => a.id !== accountId);
  saveAccounts();
  mainWindow.webContents.send('load-accounts', accounts);
  updateDockBadge();
  updateTrayMenu();

  if (activeAccountId === accountId) {
    activeAccountId = null;
    if (accounts.length > 0) switchToAccount(accounts[0].id);
  }
  trackEvent('account_removed', { accountCount: accounts.length });
});

ipcMain.on('reload-account', (_event, accountId) => {
  if (views[accountId]) views[accountId].webContents.loadURL(WHATSAPP_URL);
});

ipcMain.on('update-settings', (_event, newSettings) => {
  settings = { ...settings, ...newSettings };
  saveSettings();
  resizeAllViews();
  updateTrayMenu();
  mainWindow.webContents.send('settings-updated', settings);
  app.setLoginItemSettings({ openAtLogin: settings.launchAtLogin });
});

ipcMain.on('toggle-sidebar', () => {
  settings.sidebarCollapsed = !settings.sidebarCollapsed;
  saveSettings();
  resizeAllViews();
  mainWindow.webContents.send('settings-updated', settings);
});

ipcMain.on('set-ui-mode', (_event, mode) => {
  settings.uiMode = mode;
  saveSettings();
  resizeAllViews();
});

ipcMain.on('wa-notification', (_event, { accountId, title, body }) => {
  showNotification(accountId, title, body);
});

ipcMain.on('reorder-accounts', (_event, orderedIds) => {
  accounts = orderedIds.map((id) => accounts.find((a) => a.id === id)).filter(Boolean);
  saveAccounts();
  mainWindow.webContents.send('load-accounts', accounts);
  updateTrayMenu();
});

// ── App lifecycle ────────────────────────────────────────────

app.whenReady().then(async () => {
  // Set app name for macOS menu bar during development
  app.setName('SupaMsg');

  loadSettings();
  loadAccounts();

  // Show onboarding on first launch
  if (!fs.existsSync(ONBOARDING_PATH)) {
    await showOnboarding();
  }

  createWindow();
  createTray();

  // Safe feature initialization — wraps each in try-catch so one failure doesn't crash the app
  function safeInit(name, fn) {
    try { fn(); } catch (e) { console.error(`[SupaMsg] Failed to init ${name}:`, e.message); }
  }

  const featureCtx = { app, ipcMain, getMainWindow, getViews, getActiveAccountId, getAccounts, getSidebarWidth, accounts };

  safeInit('split-screen', () => { splitScreen = initSplitScreen({ ipcMain, getMainWindow, getViews, getAccounts, getSidebarWidth }); });
  safeInit('scheduled-messages', () => initScheduledMessages({ app, ipcMain, getMainWindow, getViews }));
  safeInit('templates', () => initTemplates({ app, ipcMain, getMainWindow, getViews, getActiveAccountId }));
  safeInit('chat-export', () => initChatExport({ ipcMain, getMainWindow, getViews, getActiveAccountId, accounts }));
  safeInit('contact-labels', () => initContactLabels({ app, ipcMain, getMainWindow }));
  safeInit('analytics', () => initAnalytics({ app, ipcMain, getMainWindow }));
  safeInit('ai-replies', () => initAiReplies({ app, ipcMain, getMainWindow, getViews, getActiveAccountId }));
  safeInit('automations', () => initAutomations({ app, ipcMain, getMainWindow, getViews, getAccounts }));
  safeInit('broadcast', () => initBroadcast({ app, ipcMain, getMainWindow, getViews }));
  safeInit('stealth-mode', () => initStealthMode({ app, ipcMain, getViews }));
  safeInit('crm', () => initCrmIntegration({ app, ipcMain, getMainWindow }));
  safeInit('licensing', () => initLicensing({ app, ipcMain, getMainWindow }));
  safeInit('mobile-relay', () => initMobileRelay({ ipcMain, getMainWindow, getViews, getAccounts }));
  safeInit('auto-updater', () => initAutoUpdater({ getMainWindow }));

  // Initialize all 30 new features
  safeInit('kanban', () => initConversationKanban(featureCtx));
  safeInit('smart-notifications', () => initSmartNotifications(featureCtx));
  safeInit('quick-actions', () => initQuickActions(featureCtx));
  safeInit('voice-transcription', () => initVoiceTranscription(featureCtx));
  safeInit('message-recall', () => initMessageRecall(featureCtx));
  safeInit('collaborative-notes', () => initCollaborativeNotes(featureCtx));
  safeInit('timezone-scheduler', () => initTimezoneScheduler(featureCtx));
  safeInit('sentiment-alerts', () => initSentimentAlerts(featureCtx));
  safeInit('payment-collection', () => initPaymentCollection(featureCtx));
  safeInit('product-catalog', () => initProductCatalog(featureCtx));
  safeInit('appointment-booking', () => initAppointmentBooking(featureCtx));
  safeInit('status-manager', () => initStatusManager(featureCtx));
  safeInit('chatbot-builder', () => initChatbotBuilder(featureCtx));
  safeInit('chat-backup', () => initChatBackup(featureCtx));
  safeInit('webhook-api', () => initWebhookApi(featureCtx));
  safeInit('ai-insights', () => initAiInsights(featureCtx));
  safeInit('ecommerce-tracking', () => initEcommerceTracking(featureCtx));
  safeInit('ai-agent', () => initAiAgent(featureCtx));
  safeInit('zapier-integration', () => initZapierIntegration(featureCtx));
  safeInit('white-label', () => initWhiteLabel(featureCtx));
  safeInit('cross-messenger', () => initCrossMessenger(featureCtx));
  safeInit('screen-mirror', () => initScreenMirror(featureCtx));
  safeInit('virtual-numbers', () => initVirtualNumbers(featureCtx));
  safeInit('sms-bridge', () => initSmsBridge(featureCtx));
  safeInit('team-inbox', () => initTeamInbox(featureCtx));
  safeInit('advanced-analytics', () => initAdvancedAnalytics(featureCtx));
  safeInit('auto-translate', () => initAutoTranslate(featureCtx));
  safeInit('custom-dashboard', () => initCustomDashboard(featureCtx));
  safeInit('whatsapp-business-api', () => initWhatsappBusinessApi(featureCtx));
  safeInit('conversation-search', () => initConversationSearch(featureCtx));
  safeInit('posthog-analytics', () => initPosthogAnalytics({ app, ipcMain }));

  // Global shortcut
  if (settings.globalShortcut) {
    globalShortcut.register(settings.globalShortcut, () => {
      if (mainWindow.isVisible() && mainWindow.isFocused()) mainWindow.hide();
      else { mainWindow.show(); mainWindow.focus(); }
    });
  }

  app.setLoginItemSettings({ openAtLogin: settings.launchAtLogin });
});

app.on('before-quit', () => {
  app.isQuitting = true;
  cleanupScheduler();
});

app.on('window-all-closed', () => {});

app.on('activate', () => { if (mainWindow) mainWindow.show(); });

app.on('will-quit', () => { globalShortcut.unregisterAll(); });
