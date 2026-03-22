const path = require('path');
const fs = require('fs');

function initSmartNotifications({ app, ipcMain, getMainWindow, getViews, getActiveAccountId, getAccounts }) {
  const rulesPath = path.join(app.getPath('userData'), 'notification-rules.json');

  const CATEGORIES = ['urgent', 'money', 'question', 'social', 'spam', 'general'];

  const PRIORITY_ORDER = {
    urgent: 0,
    money: 1,
    question: 2,
    general: 3,
    social: 4,
    spam: 5,
  };

  const KEYWORD_MAP = {
    urgent: ['urgent', 'asap', 'emergency', 'immediately', 'help', 'please call'],
    money: ['payment', 'invoice', 'price', 'cost', 'pay', '₹', '$', 'transfer', 'upi'],
    question: ['how', 'what', 'when', 'where', 'why', 'can you'],
    social: ['hi', 'hello', 'thanks', 'happy', 'birthday', 'congratulations'],
    spam: ['offer', 'discount', 'click here', 'free', 'winner', 'lottery'],
  };

  function loadRules() {
    try {
      if (fs.existsSync(rulesPath)) {
        return JSON.parse(fs.readFileSync(rulesPath, 'utf-8'));
      }
    } catch (e) {
      console.error('Error loading notification rules:', e);
    }
    // Default rules: all categories enabled, no custom sounds
    const defaults = {};
    for (const cat of CATEGORIES) {
      defaults[cat] = { enabled: true, sound: 'default' };
    }
    return defaults;
  }

  function saveRules(rules) {
    try {
      fs.writeFileSync(rulesPath, JSON.stringify(rules, null, 2), 'utf-8');
    } catch (e) {
      console.error('Error saving notification rules:', e);
    }
  }

  function categorizeText(text) {
    if (!text || typeof text !== 'string') return 'general';

    const lower = text.toLowerCase().trim();

    // Check urgent first (highest priority)
    for (const kw of KEYWORD_MAP.urgent) {
      if (lower.includes(kw)) return 'urgent';
    }

    // Check money
    for (const kw of KEYWORD_MAP.money) {
      if (lower.includes(kw)) return 'money';
    }

    // Check question — ends with "?" or starts with question words
    if (lower.endsWith('?')) return 'question';
    for (const kw of KEYWORD_MAP.question) {
      if (lower.startsWith(kw + ' ') || lower.includes(' ' + kw + ' ')) return 'question';
    }

    // Check spam
    for (const kw of KEYWORD_MAP.spam) {
      if (lower.includes(kw)) return 'spam';
    }

    // Check social
    for (const kw of KEYWORD_MAP.social) {
      if (lower.includes(kw)) return 'social';
    }

    return 'general';
  }

  // Categorize a message by text content
  ipcMain.handle('categorize-message', async (event, { text }) => {
    const category = categorizeText(text);
    return { category, priority: PRIORITY_ORDER[category] };
  });

  // Returns messages sorted by priority (urgent first, spam last)
  ipcMain.handle('get-priority-inbox', async () => {
    const views = getViews();
    const allMessages = [];

    for (const [accountId, view] of Object.entries(views)) {
      try {
        const messages = await view.webContents.executeJavaScript(`
          (function() {
            const msgs = [];
            const rows = document.querySelectorAll('[data-testid="cell-frame-container"]');
            rows.forEach(row => {
              const nameEl = row.querySelector('[data-testid="cell-frame-title"] span[title]');
              const msgEl = row.querySelector('[data-testid="last-msg-status"]');
              const timeEl = row.querySelector('[data-testid="cell-frame-secondary"]');
              if (nameEl) {
                msgs.push({
                  contact: nameEl.getAttribute('title') || '',
                  lastMessage: msgEl ? msgEl.textContent : '',
                  time: timeEl ? timeEl.textContent : '',
                });
              }
            });
            return msgs;
          })();
        `);

        for (const msg of messages) {
          const category = categorizeText(msg.lastMessage);
          allMessages.push({
            ...msg,
            accountId,
            category,
            priority: PRIORITY_ORDER[category],
          });
        }
      } catch (e) {
        console.error(`Error getting messages from account ${accountId}:`, e);
      }
    }

    allMessages.sort((a, b) => a.priority - b.priority);
    return allMessages;
  });

  // Set per-category notification settings
  ipcMain.on('set-notification-rules', (event, { category, enabled, sound }) => {
    const rules = loadRules();
    if (!rules[category]) {
      rules[category] = {};
    }
    if (typeof enabled === 'boolean') rules[category].enabled = enabled;
    if (sound !== undefined) rules[category].sound = sound;
    saveRules(rules);
  });

  // Get notification rules
  ipcMain.handle('get-notification-rules', async () => {
    return loadRules();
  });
}

module.exports = { initSmartNotifications };
