const path = require('path');
const fs = require('fs');

function initConversationKanban({ app, ipcMain, getMainWindow, getViews, getActiveAccountId, getAccounts }) {
  const dataPath = path.join(app.getPath('userData'), 'kanban-data.json');
  const columnsPath = path.join(app.getPath('userData'), 'kanban-columns.json');

  const DEFAULT_COLUMNS = [
    { id: 'new_lead', name: 'New Lead', color: '#34B7F1' },
    { id: 'contacted', name: 'Contacted', color: '#FFD700' },
    { id: 'qualified', name: 'Qualified', color: '#25D366' },
    { id: 'proposal', name: 'Proposal Sent', color: '#f093fb' },
    { id: 'closed_won', name: 'Closed Won', color: '#25D366' },
    { id: 'closed_lost', name: 'Closed Lost', color: '#ff6b6b' },
  ];

  function loadData() {
    try {
      if (fs.existsSync(dataPath)) {
        return JSON.parse(fs.readFileSync(dataPath, 'utf-8'));
      }
    } catch (e) {
      console.error('Error loading kanban data:', e);
    }
    return {};
  }

  function saveData(data) {
    try {
      fs.writeFileSync(dataPath, JSON.stringify(data, null, 2), 'utf-8');
    } catch (e) {
      console.error('Error saving kanban data:', e);
    }
  }

  function loadColumns() {
    try {
      if (fs.existsSync(columnsPath)) {
        return JSON.parse(fs.readFileSync(columnsPath, 'utf-8'));
      }
    } catch (e) {
      console.error('Error loading kanban columns:', e);
    }
    return DEFAULT_COLUMNS;
  }

  function saveColumns(columns) {
    try {
      fs.writeFileSync(columnsPath, JSON.stringify(columns, null, 2), 'utf-8');
    } catch (e) {
      console.error('Error saving kanban columns:', e);
    }
  }

  function ensureContact(data, contactKey) {
    if (!data[contactKey]) {
      data[contactKey] = {
        contactKey,
        tags: [],
        status: 'new_lead',
        notes: '',
        updatedAt: new Date().toISOString(),
      };
    }
    return data[contactKey];
  }

  // Returns all tagged conversations grouped by status
  ipcMain.handle('get-kanban-data', async () => {
    const data = loadData();
    const columns = loadColumns();
    const grouped = {};

    for (const col of columns) {
      grouped[col.id] = [];
    }

    for (const [contactKey, entry] of Object.entries(data)) {
      const status = entry.status || 'new_lead';
      if (!grouped[status]) {
        grouped[status] = [];
      }
      grouped[status].push(entry);
    }

    return grouped;
  });

  // Returns column definitions
  ipcMain.handle('get-kanban-columns', async () => {
    return loadColumns();
  });

  // Move conversation between columns
  ipcMain.on('set-conversation-status', (event, { contactKey, status }) => {
    const data = loadData();
    const contact = ensureContact(data, contactKey);
    contact.status = status;
    contact.updatedAt = new Date().toISOString();
    saveData(data);
  });

  // Add tag to conversation
  ipcMain.on('add-conversation-tag', (event, { contactKey, tag }) => {
    const data = loadData();
    const contact = ensureContact(data, contactKey);
    if (!contact.tags.includes(tag)) {
      contact.tags.push(tag);
      contact.updatedAt = new Date().toISOString();
    }
    saveData(data);
  });

  // Remove tag from conversation
  ipcMain.on('remove-conversation-tag', (event, { contactKey, tag }) => {
    const data = loadData();
    const contact = ensureContact(data, contactKey);
    contact.tags = contact.tags.filter((t) => t !== tag);
    contact.updatedAt = new Date().toISOString();
    saveData(data);
  });

  // Customize column names/colors
  ipcMain.on('save-kanban-columns', (event, columns) => {
    saveColumns(columns);
  });
}

module.exports = { initConversationKanban };
