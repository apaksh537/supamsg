const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

function initCollaborativeNotes({ app, ipcMain, getMainWindow, getViews, getActiveAccountId, getAccounts }) {
  const notesPath = path.join(app.getPath('userData'), 'contact-notes.json');

  function loadNotes() {
    try {
      if (fs.existsSync(notesPath)) {
        return JSON.parse(fs.readFileSync(notesPath, 'utf-8'));
      }
    } catch (e) {
      console.error('Error loading contact notes:', e);
    }
    return {};
  }

  function saveNotes(data) {
    try {
      fs.writeFileSync(notesPath, JSON.stringify(data, null, 2), 'utf-8');
    } catch (e) {
      console.error('Error saving contact notes:', e);
    }
  }

  function generateId() {
    return crypto.randomBytes(8).toString('hex');
  }

  function ensureContact(data, contactKey) {
    if (!data[contactKey]) {
      data[contactKey] = {
        contactKey,
        notes: [],
        pinned: '',
      };
    }
    return data[contactKey];
  }

  // Return notes for a contact
  ipcMain.handle('get-contact-notes', async (event, { contactKey }) => {
    const data = loadNotes();
    const contact = data[contactKey];
    if (!contact) {
      return { contactKey, notes: [], pinned: '' };
    }

    // Sort: pinned note first, then by createdAt descending
    const sorted = [...contact.notes].sort((a, b) => {
      if (a.id === contact.pinned) return -1;
      if (b.id === contact.pinned) return 1;
      return new Date(b.createdAt) - new Date(a.createdAt);
    });

    return { ...contact, notes: sorted };
  });

  // Return all contacts with notes
  ipcMain.handle('get-all-notes', async () => {
    const data = loadNotes();
    return Object.values(data).map((contact) => ({
      ...contact,
      noteCount: contact.notes.length,
    }));
  });

  // Add a note to a contact
  ipcMain.on('add-note', (event, { contactKey, text }) => {
    const data = loadNotes();
    const contact = ensureContact(data, contactKey);
    const note = {
      id: generateId(),
      text,
      author: 'user',
      createdAt: new Date().toISOString(),
    };
    contact.notes.push(note);
    saveNotes(data);
  });

  // Edit an existing note
  ipcMain.on('edit-note', (event, { contactKey, noteId, text }) => {
    const data = loadNotes();
    const contact = data[contactKey];
    if (!contact) return;

    const note = contact.notes.find((n) => n.id === noteId);
    if (note) {
      note.text = text;
      note.editedAt = new Date().toISOString();
      saveNotes(data);
    }
  });

  // Delete a note
  ipcMain.on('delete-note', (event, { contactKey, noteId }) => {
    const data = loadNotes();
    const contact = data[contactKey];
    if (!contact) return;

    contact.notes = contact.notes.filter((n) => n.id !== noteId);
    if (contact.pinned === noteId) {
      contact.pinned = '';
    }
    saveNotes(data);
  });

  // Pin a note to top
  ipcMain.on('pin-note', (event, { contactKey, noteId }) => {
    const data = loadNotes();
    const contact = data[contactKey];
    if (!contact) return;

    // Toggle pin: if already pinned, unpin; otherwise pin
    contact.pinned = contact.pinned === noteId ? '' : noteId;
    saveNotes(data);
  });

  // Full-text search across all notes
  ipcMain.handle('search-notes', async (event, { query }) => {
    const data = loadNotes();
    const results = [];
    const lowerQuery = query.toLowerCase();

    for (const [contactKey, contact] of Object.entries(data)) {
      for (const note of contact.notes) {
        if (note.text.toLowerCase().includes(lowerQuery)) {
          results.push({
            contactKey,
            note,
            pinned: contact.pinned === note.id,
          });
        }
      }
    }

    // Sort by most recent first
    results.sort((a, b) => new Date(b.note.createdAt) - new Date(a.note.createdAt));
    return results;
  });
}

module.exports = { initCollaborativeNotes };
