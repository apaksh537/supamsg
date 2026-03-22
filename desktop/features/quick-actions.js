const path = require('path');
const fs = require('fs');

function initQuickActions({ app, ipcMain, getMainWindow, getViews, getActiveAccountId, getAccounts }) {
  const recentActionsPath = path.join(app.getPath('userData'), 'recent-actions.json');

  const AVAILABLE_ACTIONS = [
    { id: 'send-template', label: 'Send Template', shortcut: 'CmdOrCtrl+Shift+T', icon: 'template' },
    { id: 'schedule-message', label: 'Schedule Message', shortcut: 'CmdOrCtrl+Shift+S', icon: 'schedule' },
    { id: 'add-label', label: 'Add Label', shortcut: 'CmdOrCtrl+Shift+L', icon: 'label' },
    { id: 'export-chat', label: 'Export Chat', shortcut: 'CmdOrCtrl+Shift+E', icon: 'export' },
    { id: 'translate', label: 'Translate Text', shortcut: 'CmdOrCtrl+Shift+R', icon: 'translate' },
    { id: 'ai-reply', label: 'AI Reply Suggestion', shortcut: 'CmdOrCtrl+Shift+A', icon: 'ai' },
    { id: 'toggle-stealth', label: 'Toggle Stealth Mode', shortcut: 'CmdOrCtrl+Shift+H', icon: 'stealth' },
    { id: 'search-all', label: 'Search All Accounts', shortcut: 'CmdOrCtrl+Shift+F', icon: 'search' },
  ];

  function loadRecentActions() {
    try {
      if (fs.existsSync(recentActionsPath)) {
        return JSON.parse(fs.readFileSync(recentActionsPath, 'utf-8'));
      }
    } catch (e) {
      console.error('Error loading recent actions:', e);
    }
    return [];
  }

  function saveRecentActions(actions) {
    try {
      fs.writeFileSync(recentActionsPath, JSON.stringify(actions, null, 2), 'utf-8');
    } catch (e) {
      console.error('Error saving recent actions:', e);
    }
  }

  function trackRecentAction(actionId) {
    let recent = loadRecentActions();
    // Remove if already present, then prepend
    recent = recent.filter((a) => a.id !== actionId);
    recent.unshift({ id: actionId, usedAt: new Date().toISOString() });
    // Keep only last 20
    recent = recent.slice(0, 20);
    saveRecentActions(recent);
  }

  // Returns list of available actions with shortcuts
  ipcMain.handle('get-quick-actions', async () => {
    const recent = loadRecentActions();
    const recentIds = recent.map((r) => r.id);

    return AVAILABLE_ACTIONS.map((action) => ({
      ...action,
      recentRank: recentIds.indexOf(action.id),
    })).sort((a, b) => {
      // Recently used actions first, then alphabetical
      if (a.recentRank >= 0 && b.recentRank >= 0) return a.recentRank - b.recentRank;
      if (a.recentRank >= 0) return -1;
      if (b.recentRank >= 0) return 1;
      return a.label.localeCompare(b.label);
    });
  });

  // Execute a quick action
  ipcMain.on('execute-quick-action', async (event, { action, params }) => {
    trackRecentAction(action);

    const activeAccountId = getActiveAccountId();
    const views = getViews();
    const activeView = views[activeAccountId];
    const mainWindow = getMainWindow();

    try {
      switch (action) {
        case 'send-template':
          // Signal the renderer to open template picker with current chat
          if (mainWindow) {
            mainWindow.webContents.send('quick-action-send-template', {
              accountId: activeAccountId,
              ...params,
            });
          }
          break;

        case 'schedule-message':
          if (mainWindow) {
            mainWindow.webContents.send('quick-action-schedule-message', {
              accountId: activeAccountId,
              ...params,
            });
          }
          break;

        case 'add-label':
          if (mainWindow) {
            mainWindow.webContents.send('quick-action-add-label', {
              accountId: activeAccountId,
              ...params,
            });
          }
          break;

        case 'export-chat':
          if (mainWindow) {
            mainWindow.webContents.send('quick-action-export-chat', {
              accountId: activeAccountId,
              ...params,
            });
          }
          break;

        case 'translate':
          if (mainWindow) {
            mainWindow.webContents.send('quick-action-translate', {
              accountId: activeAccountId,
              ...params,
            });
          }
          break;

        case 'ai-reply':
          if (mainWindow) {
            mainWindow.webContents.send('quick-action-ai-reply', {
              accountId: activeAccountId,
              ...params,
            });
          }
          break;

        case 'toggle-stealth':
          if (mainWindow) {
            mainWindow.webContents.send('quick-action-toggle-stealth', {
              accountId: activeAccountId,
            });
          }
          break;

        case 'search-all':
          if (mainWindow) {
            mainWindow.webContents.send('quick-action-search-all', params);
          }
          break;

        default:
          console.warn('Unknown quick action:', action);
      }
    } catch (e) {
      console.error('Error executing quick action:', action, e);
    }
  });

  // Search across all WhatsApp Web instances
  ipcMain.handle('search-all-accounts', async (event, { query }) => {
    const views = getViews();
    const results = [];

    for (const [accountId, view] of Object.entries(views)) {
      try {
        const matches = await view.webContents.executeJavaScript(`
          (function() {
            const query = ${JSON.stringify(query)}.toLowerCase();
            const matches = [];
            const rows = document.querySelectorAll('[data-testid="cell-frame-container"]');
            rows.forEach(row => {
              const nameEl = row.querySelector('[data-testid="cell-frame-title"] span[title]');
              const msgEl = row.querySelector('[data-testid="last-msg-status"]');
              const name = nameEl ? nameEl.getAttribute('title') || '' : '';
              const msg = msgEl ? msgEl.textContent || '' : '';
              if (name.toLowerCase().includes(query) || msg.toLowerCase().includes(query)) {
                matches.push({
                  contact: name,
                  lastMessage: msg,
                });
              }
            });
            return matches;
          })();
        `);

        for (const match of matches) {
          results.push({ ...match, accountId });
        }
      } catch (e) {
        console.error(`Error searching account ${accountId}:`, e);
      }
    }

    return results;
  });
}

module.exports = { initQuickActions };
