// Timezone-aware message scheduling
// Converts target timezone to local time and sends messages when due

const path = require('path');
const fs = require('fs');

const SUPPORTED_TIMEZONES = [
  { name: 'UTC', offset: '+00:00' },
  { name: 'America/New_York', offset: '-05:00' },
  { name: 'America/Los_Angeles', offset: '-08:00' },
  { name: 'Europe/London', offset: '+00:00' },
  { name: 'Europe/Berlin', offset: '+01:00' },
  { name: 'Asia/Kolkata', offset: '+05:30' },
  { name: 'Asia/Dubai', offset: '+04:00' },
  { name: 'Asia/Singapore', offset: '+08:00' },
  { name: 'Asia/Tokyo', offset: '+09:00' },
  { name: 'Australia/Sydney', offset: '+11:00' },
];

// Country code to timezone mapping for phone-based guessing
const COUNTRY_CODE_TZ = {
  '+1': 'America/New_York',
  '+44': 'Europe/London',
  '+49': 'Europe/Berlin',
  '+91': 'Asia/Kolkata',
  '+971': 'Asia/Dubai',
  '+65': 'Asia/Singapore',
  '+81': 'Asia/Tokyo',
  '+61': 'Australia/Sydney',
};

let schedulesPath;
let schedules = [];
let timerInterval;

function initTimezoneScheduler({ app, ipcMain, getMainWindow, getViews, getActiveAccountId }) {
  schedulesPath = path.join(app.getPath('userData'), 'timezone-schedules.json');
  loadSchedules();

  // Check every 30 seconds for due messages
  timerInterval = setInterval(() => checkAndSend(getViews, getMainWindow, getActiveAccountId), 30000);

  ipcMain.handle('detect-timezone', (_event, { contactName }) => {
    return detectTimezone(contactName);
  });

  ipcMain.on('schedule-timezone', (_event, { accountId, contactName, message, targetTime, targetTimezone }) => {
    const localSendTime = convertToLocalTime(targetTime, targetTimezone);
    const schedule = {
      id: `tz-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      accountId,
      contactName,
      message,
      targetTime,
      targetTimezone,
      localSendTime,
      status: 'pending',
      createdAt: new Date().toISOString(),
    };
    schedules.push(schedule);
    saveSchedules();
    broadcastSchedules(getMainWindow());
  });

  ipcMain.handle('get-timezone-schedules', () => {
    return schedules;
  });

  ipcMain.on('cancel-timezone-schedule', (_event, { id }) => {
    const sched = schedules.find((s) => s.id === id);
    if (sched) {
      sched.status = 'cancelled';
      saveSchedules();
      broadcastSchedules(getMainWindow());
    }
  });

  ipcMain.handle('get-common-timezones', () => {
    return SUPPORTED_TIMEZONES;
  });
}

function detectTimezone(contactName) {
  // Attempt to guess timezone from phone number country code
  // In real usage, contactName may contain a phone number prefix
  for (const [code, tz] of Object.entries(COUNTRY_CODE_TZ)) {
    if (contactName && contactName.includes(code)) {
      return { timezone: tz, confidence: 'medium', method: 'country_code' };
    }
  }
  // Default fallback
  return { timezone: 'UTC', confidence: 'low', method: 'fallback' };
}

function convertToLocalTime(targetTime, targetTimezone) {
  try {
    // Parse targetTime as a date string in the target timezone
    const targetDate = new Date(targetTime);
    // Use Intl to compute offset difference
    const targetOffset = getTimezoneOffsetMs(targetTimezone);
    const localOffset = new Date().getTimezoneOffset() * -60000;
    const diff = localOffset - targetOffset;
    return new Date(targetDate.getTime() + diff).toISOString();
  } catch (e) {
    return targetTime;
  }
}

function getTimezoneOffsetMs(timezone) {
  try {
    const now = new Date();
    const utcStr = now.toLocaleString('en-US', { timeZone: 'UTC' });
    const tzStr = now.toLocaleString('en-US', { timeZone: timezone });
    const utcDate = new Date(utcStr);
    const tzDate = new Date(tzStr);
    return tzDate.getTime() - utcDate.getTime();
  } catch (e) {
    return 0;
  }
}

async function checkAndSend(getViews, getMainWindow, getActiveAccountId) {
  const now = new Date();
  let changed = false;

  for (const sched of schedules) {
    if (sched.status !== 'pending') continue;
    const sendTime = new Date(sched.localSendTime);
    if (now >= sendTime) {
      try {
        await sendScheduledMessage(sched, getViews, getActiveAccountId);
        sched.status = 'sent';
        sched.sentAt = now.toISOString();
      } catch (e) {
        sched.status = 'failed';
        sched.error = e.message;
      }
      changed = true;
    }
  }

  if (changed) {
    saveSchedules();
    const mainWindow = getMainWindow();
    if (mainWindow && !mainWindow.isDestroyed()) {
      broadcastSchedules(mainWindow);
    }
  }
}

async function sendScheduledMessage(sched, getViews, getActiveAccountId) {
  const views = getViews();
  const accountId = sched.accountId || getActiveAccountId();
  const view = views[accountId];
  if (!view || view.webContents.isDestroyed()) {
    throw new Error('Account view not available');
  }

  const contactName = sched.contactName.replace(/'/g, "\\'");
  const message = sched.message.replace(/'/g, "\\'").replace(/\n/g, '\\n');

  await view.webContents.executeJavaScript(`
    (async () => {
      const searchBox = document.querySelector('div[contenteditable="true"][data-tab="3"]');
      if (!searchBox) throw new Error('Search box not found');
      searchBox.focus();
      document.execCommand('insertText', false, '${contactName}');
      await new Promise(r => setTimeout(r, 1500));
      const contacts = document.querySelectorAll('span[title]');
      let found = false;
      for (const c of contacts) {
        if (c.title && c.title.toLowerCase().includes('${contactName}'.toLowerCase())) {
          c.click();
          found = true;
          break;
        }
      }
      if (!found) throw new Error('Contact not found');
      await new Promise(r => setTimeout(r, 1000));
      const msgBox = document.querySelector('div[contenteditable="true"][data-tab="10"]');
      if (!msgBox) throw new Error('Message box not found');
      msgBox.focus();
      document.execCommand('insertText', false, '${message}');
      await new Promise(r => setTimeout(r, 300));
      const sendBtn = document.querySelector('span[data-icon="send"]');
      if (sendBtn) sendBtn.click();
    })();
  `);
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
  try {
    fs.writeFileSync(schedulesPath, JSON.stringify(schedules, null, 2), 'utf8');
  } catch (e) {
    console.error('Failed to save timezone schedules:', e);
  }
}

function broadcastSchedules(mainWindow) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('timezone-schedules-updated', schedules);
  }
}

module.exports = { initTimezoneScheduler };
