const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

function initMessageRecall({ app, ipcMain, getMainWindow, getViews, getActiveAccountId, getAccounts }) {
  const recallsPath = path.join(app.getPath('userData'), 'pending-recalls.json');
  let checkInterval = null;

  function loadRecalls() {
    try {
      if (fs.existsSync(recallsPath)) {
        return JSON.parse(fs.readFileSync(recallsPath, 'utf-8'));
      }
    } catch (e) {
      console.error('Error loading pending recalls:', e);
    }
    return { defaultRecallMinutes: 0, pending: [] };
  }

  function saveRecalls(data) {
    try {
      fs.writeFileSync(recallsPath, JSON.stringify(data, null, 2), 'utf-8');
    } catch (e) {
      console.error('Error saving pending recalls:', e);
    }
  }

  function generateId() {
    return crypto.randomBytes(8).toString('hex');
  }

  async function executeRecall(recall) {
    const views = getViews();
    const view = views[recall.accountId];
    if (!view) {
      console.error(`No active view for account ${recall.accountId}, cannot recall message`);
      return false;
    }

    try {
      const result = await view.webContents.executeJavaScript(`
        (function() {
          const messageText = ${JSON.stringify(recall.messageText)};

          // Find the message by text content in outgoing messages
          const outgoingMsgs = document.querySelectorAll('.message-out');
          let targetMsg = null;

          for (let i = outgoingMsgs.length - 1; i >= 0; i--) {
            const msgEl = outgoingMsgs[i];
            const textContent = msgEl.querySelector('[data-testid="msg-container"]');
            if (textContent && textContent.textContent.includes(messageText)) {
              targetMsg = msgEl;
              break;
            }
          }

          if (!targetMsg) {
            return { success: false, error: 'Message not found' };
          }

          // Simulate right-click / long-press on the message
          const contextEvent = new MouseEvent('contextmenu', {
            bubbles: true,
            cancelable: true,
            view: window,
            clientX: targetMsg.getBoundingClientRect().x + 10,
            clientY: targetMsg.getBoundingClientRect().y + 10,
          });
          targetMsg.dispatchEvent(contextEvent);

          // Wait briefly for context menu to appear, then click delete
          return new Promise(resolve => {
            setTimeout(() => {
              // Look for "Delete" option in context menu
              const menuItems = document.querySelectorAll('[data-testid="mi-msg-delete"]');
              if (menuItems.length > 0) {
                menuItems[0].click();

                // Wait for the delete confirmation dialog
                setTimeout(() => {
                  const deleteForEveryone = document.querySelector('[data-testid="btn-delete-for-everyone"]');
                  if (deleteForEveryone) {
                    deleteForEveryone.click();
                    resolve({ success: true });
                  } else {
                    resolve({ success: false, error: 'Delete for everyone button not found' });
                  }
                }, 500);
              } else {
                resolve({ success: false, error: 'Delete menu item not found' });
              }
            }, 500);
          });
        })();
      `);

      return result.success;
    } catch (e) {
      console.error('Error executing recall:', e);
      return false;
    }
  }

  async function checkPendingRecalls() {
    const data = loadRecalls();
    const now = Date.now();
    let changed = false;

    for (const recall of data.pending) {
      if (recall.status !== 'pending') continue;

      const dueAt = new Date(recall.dueAt).getTime();
      if (now >= dueAt) {
        const success = await executeRecall(recall);
        recall.status = success ? 'completed' : 'failed';
        recall.executedAt = new Date().toISOString();
        changed = true;

        // Notify renderer about the recall result
        const mainWindow = getMainWindow();
        if (mainWindow) {
          mainWindow.webContents.send('recall-executed', {
            recallId: recall.id,
            success,
            messageText: recall.messageText,
            accountId: recall.accountId,
          });
        }
      }
    }

    if (changed) {
      // Clean up old completed/failed recalls (keep last 50)
      const active = data.pending.filter((r) => r.status === 'pending');
      const inactive = data.pending.filter((r) => r.status !== 'pending').slice(-50);
      data.pending = [...active, ...inactive];
      saveRecalls(data);
    }
  }

  // Schedule a message recall
  ipcMain.on('set-recall-timer', (event, { accountId, messageText, delayMinutes }) => {
    const data = loadRecalls();
    const recall = {
      id: generateId(),
      accountId,
      messageText,
      delayMinutes,
      status: 'pending',
      createdAt: new Date().toISOString(),
      dueAt: new Date(Date.now() + delayMinutes * 60 * 1000).toISOString(),
    };
    data.pending.push(recall);
    saveRecalls(data);
  });

  // Return all scheduled recalls
  ipcMain.handle('get-pending-recalls', async () => {
    const data = loadRecalls();
    return data.pending.filter((r) => r.status === 'pending');
  });

  // Cancel a pending recall
  ipcMain.on('cancel-recall', (event, { recallId }) => {
    const data = loadRecalls();
    const recall = data.pending.find((r) => r.id === recallId);
    if (recall) {
      recall.status = 'cancelled';
      recall.cancelledAt = new Date().toISOString();
      saveRecalls(data);
    }
  });

  // Set default auto-recall time for all messages (0 = disabled)
  ipcMain.on('set-default-recall', (event, { minutes }) => {
    const data = loadRecalls();
    data.defaultRecallMinutes = minutes;
    saveRecalls(data);
  });

  // Start the recall checker interval (every 30 seconds)
  checkInterval = setInterval(checkPendingRecalls, 30 * 1000);

  // Clean up on app quit
  app.on('before-quit', () => {
    if (checkInterval) {
      clearInterval(checkInterval);
      checkInterval = null;
    }
  });
}

module.exports = { initMessageRecall };
