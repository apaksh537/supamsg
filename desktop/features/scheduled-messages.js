// Scheduled Messages: compose now, send later
// Stores schedules in local JSON, runs a timer to inject messages at the right time

const path = require('path');
const fs = require('fs');

let schedulesPath;
let schedules = [];
let timerInterval;

function initScheduledMessages({ app, ipcMain, getMainWindow, getViews }) {
  schedulesPath = path.join(app.getPath('userData'), 'schedules.json');
  loadSchedules();

  // Check every 30 seconds for due messages
  timerInterval = setInterval(() => checkAndSend(getViews, getMainWindow), 30000);

  ipcMain.on('get-schedules', (event) => {
    event.returnValue = schedules;
  });

  ipcMain.handle('get-schedules-async', () => {
    return schedules;
  });

  ipcMain.on('add-schedule', (_event, schedule) => {
    schedule.id = `sched-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    schedule.status = 'pending';
    schedule.createdAt = new Date().toISOString();
    schedules.push(schedule);
    saveSchedules();
    broadcastSchedules(getMainWindow());
  });

  ipcMain.on('cancel-schedule', (_event, scheduleId) => {
    schedules = schedules.filter((s) => s.id !== scheduleId);
    saveSchedules();
    broadcastSchedules(getMainWindow());
  });

  ipcMain.on('edit-schedule', (_event, { id, updates }) => {
    const sched = schedules.find((s) => s.id === id);
    if (sched && sched.status === 'pending') {
      Object.assign(sched, updates);
      saveSchedules();
      broadcastSchedules(getMainWindow());
    }
  });
}

function loadSchedules() {
  try {
    if (fs.existsSync(schedulesPath)) {
      schedules = JSON.parse(fs.readFileSync(schedulesPath, 'utf8'));
    }
  } catch (e) {
    schedules = [];
  }
}

function saveSchedules() {
  fs.writeFileSync(schedulesPath, JSON.stringify(schedules, null, 2));
}

function broadcastSchedules(mainWindow) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('schedules-updated', schedules);
  }
}

async function checkAndSend(getViews, getMainWindow) {
  const now = new Date();
  const views = getViews();

  for (const schedule of schedules) {
    if (schedule.status !== 'pending') continue;

    const sendAt = new Date(schedule.sendAt);
    if (sendAt <= now) {
      // Time to send!
      const view = views[schedule.accountId];
      if (!view) {
        schedule.status = 'failed';
        schedule.error = 'Account view not found';
        continue;
      }

      try {
        // Inject script to search for contact and send message
        // This uses WhatsApp Web's internal search + send mechanism
        const result = await view.webContents.executeJavaScript(`
          (async () => {
            const searchQuery = ${JSON.stringify(schedule.contactName)};
            const message = ${JSON.stringify(schedule.message)};

            // Click the search/new chat button
            const searchBox = document.querySelector('[data-testid="chat-list-search"]') ||
                              document.querySelector('[contenteditable="true"][data-tab="3"]');
            if (!searchBox) return { success: false, error: 'Search box not found' };

            // Focus and type into search
            searchBox.focus();
            searchBox.textContent = '';
            document.execCommand('insertText', false, searchQuery);

            // Wait for search results
            await new Promise(r => setTimeout(r, 2000));

            // Click first matching result
            const results = document.querySelectorAll('[data-testid="cell-frame-container"]');
            if (results.length === 0) return { success: false, error: 'Contact not found: ' + searchQuery };
            results[0].click();

            // Wait for chat to open
            await new Promise(r => setTimeout(r, 1000));

            // Find message input and type
            const msgInput = document.querySelector('[data-testid="conversation-compose-box-input"]') ||
                             document.querySelector('footer [contenteditable="true"]');
            if (!msgInput) return { success: false, error: 'Message input not found' };

            msgInput.focus();
            document.execCommand('insertText', false, message);

            // Click send
            await new Promise(r => setTimeout(r, 500));
            const sendBtn = document.querySelector('[data-testid="send"]') ||
                            document.querySelector('footer button[aria-label="Send"]');
            if (sendBtn) {
              sendBtn.click();
              return { success: true };
            }

            // Try pressing Enter as fallback
            msgInput.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true }));
            return { success: true, method: 'enter-key' };
          })();
        `);

        if (result?.success) {
          schedule.status = 'sent';
          schedule.sentAt = new Date().toISOString();
        } else {
          schedule.status = 'failed';
          schedule.error = result?.error || 'Unknown error';
        }
      } catch (err) {
        schedule.status = 'failed';
        schedule.error = err.message;
      }
    }
  }

  saveSchedules();
  broadcastSchedules(getMainWindow());
}

function cleanup() {
  if (timerInterval) clearInterval(timerInterval);
}

module.exports = { initScheduledMessages, cleanup };
