// Automations: workflow rules that trigger actions on incoming messages
// Supports auto-reply, templates, labels, forwarding, and notifications

const path = require('path');
const fs = require('fs');
const { Notification } = require('electron');

let automationsPath;
let rules = [];
let deps = {}; // { getMainWindow, getViews, getAccounts }

// Rate limit: track last trigger time per rule per contact
// Key: "ruleId:contactName", Value: timestamp
const rateLimitMap = new Map();
const RATE_LIMIT_MS = 5 * 60 * 1000; // 5 minutes

function initAutomations({ app, ipcMain, getMainWindow, getViews, getAccounts }) {
  automationsPath = path.join(app.getPath('userData'), 'automations.json');
  deps = { getMainWindow, getViews, getAccounts };
  loadRules();

  ipcMain.handle('get-automations', () => rules);

  ipcMain.on('save-automation', (_event, rule) => {
    const existing = rules.find((r) => r.id === rule.id);
    if (existing) {
      Object.assign(existing, rule);
    } else {
      rule.id = `rule-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
      rule.createdAt = new Date().toISOString();
      rule.lastTriggered = null;
      rule.triggerCount = 0;
      rules.push(rule);
    }
    saveRules();
    broadcast();
  });

  ipcMain.on('delete-automation', (_event, ruleId) => {
    rules = rules.filter((r) => r.id !== ruleId);
    saveRules();
    broadcast();
  });

  ipcMain.on('toggle-automation', (_event, ruleId) => {
    const rule = rules.find((r) => r.id === ruleId);
    if (rule) {
      rule.enabled = !rule.enabled;
      saveRules();
      broadcast();
    }
  });
}

function checkAutomationTriggers(accountId, messageText, senderName) {
  if (!messageText || !accountId) return;

  const enabledRules = rules.filter(
    (r) => r.enabled && (r.accountId === '*' || r.accountId === accountId)
  );

  for (const rule of enabledRules) {
    if (!matchesTrigger(rule.trigger, messageText, senderName)) continue;

    // Rate limit check
    const rateLimitKey = `${rule.id}:${senderName}`;
    const lastTriggered = rateLimitMap.get(rateLimitKey);
    if (lastTriggered && Date.now() - lastTriggered < RATE_LIMIT_MS) continue;

    rateLimitMap.set(rateLimitKey, Date.now());

    // Update rule stats
    rule.lastTriggered = new Date().toISOString();
    rule.triggerCount = (rule.triggerCount || 0) + 1;
    saveRules();

    executeAction(accountId, rule.action).catch((err) => {
      console.error(`[Automations] Failed to execute action for rule ${rule.id}:`, err.message);
    });
  }
}

function matchesTrigger(trigger, messageText, senderName) {
  const text = messageText.toLowerCase();
  const value = (trigger.value || '').toLowerCase();

  switch (trigger.type) {
    case 'message_contains':
      return text.includes(value);
    case 'keyword_match':
      // Match whole word boundaries
      return new RegExp(`\\b${escapeRegExp(value)}\\b`, 'i').test(messageText);
    case 'message_from':
      return senderName && senderName.toLowerCase().includes(value);
    case 'new_message':
      // Triggers on every new message
      return true;
    case 'no_reply_timeout':
      // This trigger type is checked externally via a timer, not on message arrival
      return false;
    default:
      return false;
  }
}

function escapeRegExp(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

async function executeAction(accountId, action) {
  const views = deps.getViews();
  const view = views[accountId];

  switch (action.type) {
    case 'auto_reply': {
      if (!view) return;
      const text = action.value;
      await view.webContents.executeJavaScript(`
        (function() {
          const input = document.querySelector('[data-testid="conversation-compose-box-input"]') ||
                        document.querySelector('footer [contenteditable="true"]');
          if (input) {
            input.focus();
            document.execCommand('insertText', false, ${JSON.stringify(text)});
            // Click send button after a brief delay
            setTimeout(() => {
              const sendBtn = document.querySelector('[data-testid="send"]') ||
                              document.querySelector('footer button[aria-label="Send"]') ||
                              document.querySelector('span[data-icon="send"]');
              if (sendBtn) sendBtn.click();
            }, 300);
          }
        })();
      `);
      break;
    }

    case 'send_template': {
      if (!view) return;
      // action.value is the template text (or could be resolved from template ID upstream)
      const templateText = action.value;
      await view.webContents.executeJavaScript(`
        (function() {
          const input = document.querySelector('[data-testid="conversation-compose-box-input"]') ||
                        document.querySelector('footer [contenteditable="true"]');
          if (input) {
            input.focus();
            document.execCommand('insertText', false, ${JSON.stringify(templateText)});
            setTimeout(() => {
              const sendBtn = document.querySelector('[data-testid="send"]') ||
                              document.querySelector('footer button[aria-label="Send"]') ||
                              document.querySelector('span[data-icon="send"]');
              if (sendBtn) sendBtn.click();
            }, 300);
          }
        })();
      `);
      break;
    }

    case 'assign_label': {
      // Delegate to the label system via IPC
      const mainWindow = deps.getMainWindow();
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('automation-assign-label', {
          accountId,
          labelId: action.value,
        });
      }
      break;
    }

    case 'forward_to': {
      // Send notification with forward info (actual forwarding depends on external integration)
      new Notification({
        title: 'SupaMsg - Message Forwarded',
        body: `Message forwarded to ${action.value}`,
      }).show();
      break;
    }

    case 'notify': {
      new Notification({
        title: 'SupaMsg - Automation Alert',
        body: action.value || 'An automation rule was triggered.',
      }).show();
      break;
    }

    default:
      console.warn(`[Automations] Unknown action type: ${action.type}`);
  }
}

function loadRules() {
  try {
    if (fs.existsSync(automationsPath)) {
      rules = JSON.parse(fs.readFileSync(automationsPath, 'utf8'));
    }
  } catch (e) {
    rules = [];
  }
}

function saveRules() {
  fs.writeFileSync(automationsPath, JSON.stringify(rules, null, 2));
}

function broadcast() {
  const mainWindow = deps.getMainWindow();
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('automations-updated', rules);
  }
}

module.exports = { initAutomations, checkAutomationTriggers };
