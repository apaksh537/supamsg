// WhatsApp Status/Stories Manager — view and manage Status updates
// Scrape, post, and schedule WhatsApp Status updates

const path = require('path');
const fs = require('fs');

let scheduledPath;
let scheduledStatuses = [];
let timerInterval;

function initStatusManager({ app, ipcMain, getMainWindow, getViews, getActiveAccountId, getAccounts }) {
  scheduledPath = path.join(app.getPath('userData'), 'scheduled-statuses.json');
  loadScheduled();

  // Check every 30 seconds for scheduled statuses
  timerInterval = setInterval(() => checkScheduled(getViews, getMainWindow, getActiveAccountId), 30000);

  ipcMain.handle('get-status-updates', async (_event, { accountId }) => {
    try {
      const views = getViews();
      const view = views[accountId];
      if (!view || view.webContents.isDestroyed()) return [];

      const statuses = await view.webContents.executeJavaScript(`
        (async () => {
          // Navigate to Status tab
          const statusTab = document.querySelector('button[aria-label="Status"]') ||
            document.querySelector('span[data-icon="status-v3"]');
          if (statusTab) statusTab.click();
          await new Promise(r => setTimeout(r, 1500));

          // Scrape visible statuses
          const statusItems = document.querySelectorAll('div[aria-label*="status" i], div[data-testid*="status"]');
          const results = [];
          statusItems.forEach((item) => {
            const nameEl = item.querySelector('span[title]');
            const timeEl = item.querySelector('span[class*="time"], span[dir="auto"]:last-child');
            if (nameEl) {
              results.push({
                contactName: nameEl.title || nameEl.textContent || '',
                time: timeEl ? timeEl.textContent || '' : '',
                type: 'text',
              });
            }
          });
          return results;
        })();
      `);

      return statuses || [];
    } catch (e) {
      console.error('Failed to get status updates:', e);
      return [];
    }
  });

  ipcMain.on('post-status', async (_event, { accountId, text }) => {
    try {
      await postStatusToAccount(accountId, text, getViews);
    } catch (e) {
      console.error('Failed to post status:', e);
    }
  });

  ipcMain.on('schedule-status', (_event, { accountId, text, postAt }) => {
    const scheduled = {
      id: `status-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      accountId,
      text,
      postAt,
      status: 'pending',
      createdAt: new Date().toISOString(),
    };
    scheduledStatuses.push(scheduled);
    saveScheduled();
    broadcastScheduled(getMainWindow());
  });

  ipcMain.handle('get-scheduled-statuses', () => {
    return scheduledStatuses;
  });

  ipcMain.on('cancel-scheduled-status', (_event, { id }) => {
    const item = scheduledStatuses.find((s) => s.id === id);
    if (item) {
      item.status = 'cancelled';
      saveScheduled();
      broadcastScheduled(getMainWindow());
    }
  });

  ipcMain.on('post-status-all-accounts', async (_event, { text }) => {
    try {
      const accounts = getAccounts();
      const views = getViews();
      for (const account of accounts) {
        const accountId = account.id || account.accountId;
        if (views[accountId] && !views[accountId].webContents.isDestroyed()) {
          try {
            await postStatusToAccount(accountId, text, getViews);
            // Wait between posts to avoid rate issues
            await new Promise((r) => setTimeout(r, 3000));
          } catch (e) {
            console.error(`Failed to post status for account ${accountId}:`, e);
          }
        }
      }
    } catch (e) {
      console.error('Failed to post status to all accounts:', e);
    }
  });
}

async function postStatusToAccount(accountId, text, getViews) {
  const views = getViews();
  const view = views[accountId];
  if (!view || view.webContents.isDestroyed()) {
    throw new Error('Account view not available');
  }

  const escapedText = text.replace(/'/g, "\\'").replace(/\n/g, '\\n');

  await view.webContents.executeJavaScript(`
    (async () => {
      // Click Status tab
      const statusTab = document.querySelector('button[aria-label="Status"]') ||
        document.querySelector('span[data-icon="status-v3"]');
      if (statusTab) statusTab.click();
      await new Promise(r => setTimeout(r, 1500));

      // Click "My status" or the pencil/text icon to create text status
      const myStatus = document.querySelector('div[aria-label="My status"]') ||
        document.querySelector('span[data-icon="status-v3-pencil"]') ||
        document.querySelector('span[data-icon="pencil"]');
      if (myStatus) myStatus.click();
      await new Promise(r => setTimeout(r, 1000));

      // Type the status text
      const textInput = document.querySelector('div[contenteditable="true"]');
      if (!textInput) throw new Error('Status text input not found');
      textInput.focus();
      document.execCommand('insertText', false, '${escapedText}');
      await new Promise(r => setTimeout(r, 500));

      // Click send
      const sendBtn = document.querySelector('span[data-icon="send"]');
      if (sendBtn) sendBtn.click();
    })();
  `);
}

async function checkScheduled(getViews, getMainWindow, getActiveAccountId) {
  const now = new Date();
  let changed = false;

  for (const item of scheduledStatuses) {
    if (item.status !== 'pending') continue;
    const postTime = new Date(item.postAt);
    if (now >= postTime) {
      try {
        await postStatusToAccount(item.accountId, item.text, getViews);
        item.status = 'posted';
        item.postedAt = now.toISOString();
      } catch (e) {
        item.status = 'failed';
        item.error = e.message;
      }
      changed = true;
    }
  }

  if (changed) {
    saveScheduled();
    const mainWindow = getMainWindow();
    if (mainWindow && !mainWindow.isDestroyed()) {
      broadcastScheduled(mainWindow);
    }
  }
}

function loadScheduled() {
  try {
    if (fs.existsSync(scheduledPath)) {
      scheduledStatuses = JSON.parse(fs.readFileSync(scheduledPath, 'utf8'));
    }
  } catch (e) {
    scheduledStatuses = [];
  }
}

function saveScheduled() {
  try {
    fs.writeFileSync(scheduledPath, JSON.stringify(scheduledStatuses, null, 2), 'utf8');
  } catch (e) {
    console.error('Failed to save scheduled statuses:', e);
  }
}

function broadcastScheduled(mainWindow) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('scheduled-statuses-updated', scheduledStatuses);
  }
}

module.exports = { initStatusManager };
