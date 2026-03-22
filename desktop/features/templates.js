// Message Templates: save & reuse canned responses
// Supports variables like {name}, {date}, {time}

const path = require('path');
const fs = require('fs');

let templatesPath;
let templates = [];

function initTemplates({ app, ipcMain, getMainWindow, getViews, getActiveAccountId }) {
  templatesPath = path.join(app.getPath('userData'), 'templates.json');
  loadTemplates();

  ipcMain.handle('get-templates', () => templates);

  ipcMain.on('save-template', (_event, template) => {
    const existing = templates.find((t) => t.id === template.id);
    if (existing) {
      Object.assign(existing, template);
    } else {
      template.id = `tpl-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
      template.createdAt = new Date().toISOString();
      templates.push(template);
    }
    saveTemplates();
    broadcastTemplates(getMainWindow());
  });

  ipcMain.on('delete-template', (_event, templateId) => {
    templates = templates.filter((t) => t.id !== templateId);
    saveTemplates();
    broadcastTemplates(getMainWindow());
  });

  ipcMain.on('reorder-templates', (_event, orderedIds) => {
    templates = orderedIds.map((id) => templates.find((t) => t.id === id)).filter(Boolean);
    saveTemplates();
  });

  // Insert template text into active WhatsApp chat
  ipcMain.on('insert-template', async (_event, { templateId, variables }) => {
    const tpl = templates.find((t) => t.id === templateId);
    if (!tpl) return;

    let text = tpl.body;
    // Replace variables
    if (variables) {
      for (const [key, val] of Object.entries(variables)) {
        text = text.replace(new RegExp(`\\{${key}\\}`, 'g'), val);
      }
    }
    // Replace built-in variables
    text = text.replace(/\{date\}/g, new Date().toLocaleDateString());
    text = text.replace(/\{time\}/g, new Date().toLocaleTimeString());

    const activeId = getActiveAccountId();
    const views = getViews();
    if (!activeId || !views[activeId]) return;

    await views[activeId].webContents.executeJavaScript(`
      (function() {
        const input = document.querySelector('[data-testid="conversation-compose-box-input"]') ||
                      document.querySelector('footer [contenteditable="true"]');
        if (input) {
          input.focus();
          document.execCommand('insertText', false, ${JSON.stringify(text)});
        }
      })();
    `);
  });
}

function loadTemplates() {
  try {
    if (fs.existsSync(templatesPath)) {
      templates = JSON.parse(fs.readFileSync(templatesPath, 'utf8'));
    }
  } catch (e) {
    templates = [];
  }

  // Add default templates if empty
  if (templates.length === 0) {
    templates = [
      {
        id: 'tpl-default-1',
        name: 'Quick Acknowledge',
        body: 'Got it, thanks! I\'ll get back to you shortly.',
        category: 'General',
        createdAt: new Date().toISOString(),
      },
      {
        id: 'tpl-default-2',
        name: 'Meeting Follow-up',
        body: 'Hi! Thanks for the meeting today ({date}). Here are the key takeaways:\n\n1. \n2. \n3. \n\nLet me know if I missed anything.',
        category: 'Work',
        createdAt: new Date().toISOString(),
      },
      {
        id: 'tpl-default-3',
        name: 'Running Late',
        body: 'Hey, running about 10-15 mins late. Will be there soon!',
        category: 'General',
        createdAt: new Date().toISOString(),
      },
    ];
    saveTemplates();
  }
}

function saveTemplates() {
  fs.writeFileSync(templatesPath, JSON.stringify(templates, null, 2));
}

function broadcastTemplates(mainWindow) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('templates-updated', templates);
  }
}

module.exports = { initTemplates };
