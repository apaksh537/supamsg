// Contact Labels: tag contacts with custom labels (VIP, Work, Family, etc.)
// Stored locally, not synced to WhatsApp

const path = require('path');
const fs = require('fs');

let labelsPath;
let labels = []; // { id, name, color }
let contactLabels = {}; // { "contactName:accountId": ["label-id", ...] }

function initContactLabels({ app, ipcMain, getMainWindow }) {
  labelsPath = path.join(app.getPath('userData'), 'contact-labels.json');
  loadData();

  ipcMain.handle('get-labels', () => ({ labels, contactLabels }));

  ipcMain.on('create-label', (_event, { name, color }) => {
    const label = {
      id: `label-${Date.now()}`,
      name,
      color: color || '#25D366',
      createdAt: new Date().toISOString(),
    };
    labels.push(label);
    saveData();
    broadcast(getMainWindow());
  });

  ipcMain.on('update-label', (_event, { id, name, color }) => {
    const label = labels.find((l) => l.id === id);
    if (label) {
      if (name) label.name = name;
      if (color) label.color = color;
      saveData();
      broadcast(getMainWindow());
    }
  });

  ipcMain.on('delete-label', (_event, labelId) => {
    labels = labels.filter((l) => l.id !== labelId);
    // Remove from all contacts
    for (const key of Object.keys(contactLabels)) {
      contactLabels[key] = contactLabels[key].filter((id) => id !== labelId);
      if (contactLabels[key].length === 0) delete contactLabels[key];
    }
    saveData();
    broadcast(getMainWindow());
  });

  ipcMain.on('assign-label', (_event, { contactKey, labelId }) => {
    if (!contactLabels[contactKey]) contactLabels[contactKey] = [];
    if (!contactLabels[contactKey].includes(labelId)) {
      contactLabels[contactKey].push(labelId);
      saveData();
      broadcast(getMainWindow());
    }
  });

  ipcMain.on('remove-label-from-contact', (_event, { contactKey, labelId }) => {
    if (contactLabels[contactKey]) {
      contactLabels[contactKey] = contactLabels[contactKey].filter((id) => id !== labelId);
      if (contactLabels[contactKey].length === 0) delete contactLabels[contactKey];
      saveData();
      broadcast(getMainWindow());
    }
  });
}

function loadData() {
  try {
    if (fs.existsSync(labelsPath)) {
      const data = JSON.parse(fs.readFileSync(labelsPath, 'utf8'));
      labels = data.labels || [];
      contactLabels = data.contactLabels || {};
    }
  } catch (e) {
    labels = [];
    contactLabels = {};
  }

  // Default labels
  if (labels.length === 0) {
    labels = [
      { id: 'label-vip', name: 'VIP', color: '#FFD700', createdAt: new Date().toISOString() },
      { id: 'label-work', name: 'Work', color: '#34B7F1', createdAt: new Date().toISOString() },
      { id: 'label-family', name: 'Family', color: '#FF6B6B', createdAt: new Date().toISOString() },
      { id: 'label-client', name: 'Client', color: '#25D366', createdAt: new Date().toISOString() },
    ];
    saveData();
  }
}

function saveData() {
  fs.writeFileSync(labelsPath, JSON.stringify({ labels, contactLabels }, null, 2));
}

function broadcast(mainWindow) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('labels-updated', { labels, contactLabels });
  }
}

module.exports = { initContactLabels };
