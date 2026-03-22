const path = require('path');
const fs = require('fs');
const uuidv4 = () => require('crypto').randomUUID();

function initTeamInbox({ app, ipcMain, getMainWindow, getViews, getActiveAccountId, getAccounts }) {
  const userDataPath = app.getPath('userData');
  const teamMembersPath = path.join(userDataPath, 'team-members.json');
  const assignmentsPath = path.join(userDataPath, 'assignments.json');
  const internalNotesPath = path.join(userDataPath, 'internal-notes.json');

  // --- Helpers ---

  function readJSON(filePath, fallback = []) {
    try {
      if (fs.existsSync(filePath)) {
        return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
      }
    } catch (e) {
      console.error(`[team-inbox] Failed to read ${filePath}:`, e.message);
    }
    return fallback;
  }

  function writeJSON(filePath, data) {
    try {
      fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
    } catch (e) {
      console.error(`[team-inbox] Failed to write ${filePath}:`, e.message);
    }
  }

  function getTeamMembers() {
    return readJSON(teamMembersPath);
  }

  function saveTeamMembers(members) {
    writeJSON(teamMembersPath, members);
  }

  function getAssignments() {
    return readJSON(assignmentsPath);
  }

  function saveAssignments(assignments) {
    writeJSON(assignmentsPath, assignments);
  }

  function getInternalNotes() {
    return readJSON(internalNotesPath);
  }

  function saveInternalNotes(notes) {
    writeJSON(internalNotesPath, notes);
  }

  // In-memory conversation locks: { contactKey: { memberId, lockedAt } }
  const conversationLocks = {};

  // --- IPC Handlers ---

  // Team Members
  ipcMain.handle('get-team-members', async () => {
    return getTeamMembers();
  });

  ipcMain.on('add-team-member', (event, { name, email, role }) => {
    const members = getTeamMembers();
    const colors = ['#FF6B6B', '#4ECDC4', '#45B7D1', '#96CEB4', '#FFEAA7', '#DDA0DD', '#98D8C8', '#F7DC6F'];
    const member = {
      id: uuidv4(),
      name,
      email,
      role: role || 'agent',
      color: colors[members.length % colors.length],
      isOnline: false,
    };
    members.push(member);
    saveTeamMembers(members);

    const win = getMainWindow();
    if (win) win.webContents.send('team-members-updated', members);
  });

  ipcMain.on('remove-team-member', (event, { memberId }) => {
    let members = getTeamMembers();
    members = members.filter((m) => m.id !== memberId);
    saveTeamMembers(members);

    // Also unassign any conversations assigned to this member
    let assignments = getAssignments();
    assignments = assignments.filter((a) => a.assignedTo !== memberId);
    saveAssignments(assignments);

    const win = getMainWindow();
    if (win) win.webContents.send('team-members-updated', members);
  });

  // Assignments
  ipcMain.handle('get-assignments', async () => {
    return getAssignments().filter((a) => a.status !== 'resolved');
  });

  ipcMain.on('assign-conversation', (event, { contactKey, memberId }) => {
    const assignments = getAssignments();
    const existing = assignments.find((a) => a.contactKey === contactKey && a.status !== 'resolved');
    if (existing) {
      existing.assignedTo = memberId;
      existing.assignedAt = new Date().toISOString();
    } else {
      assignments.push({
        contactKey,
        assignedTo: memberId,
        assignedAt: new Date().toISOString(),
        status: 'open',
      });
    }
    saveAssignments(assignments);

    const win = getMainWindow();
    if (win) win.webContents.send('assignments-updated', assignments);
  });

  ipcMain.on('unassign-conversation', (event, { contactKey }) => {
    const assignments = getAssignments();
    const idx = assignments.findIndex((a) => a.contactKey === contactKey && a.status !== 'resolved');
    if (idx !== -1) {
      assignments.splice(idx, 1);
      saveAssignments(assignments);
    }

    const win = getMainWindow();
    if (win) win.webContents.send('assignments-updated', assignments);
  });

  ipcMain.on('resolve-conversation', (event, { contactKey }) => {
    const assignments = getAssignments();
    const assignment = assignments.find((a) => a.contactKey === contactKey && a.status !== 'resolved');
    if (assignment) {
      assignment.status = 'resolved';
      assignment.resolvedAt = new Date().toISOString();
      saveAssignments(assignments);
    }

    // Release any lock
    delete conversationLocks[contactKey];

    const win = getMainWindow();
    if (win) win.webContents.send('assignments-updated', assignments);
  });

  // Internal Notes
  ipcMain.handle('get-internal-notes', async (event, { contactKey }) => {
    const notes = getInternalNotes();
    return notes.filter((n) => n.contactKey === contactKey);
  });

  ipcMain.on('add-internal-note', (event, { contactKey, memberId, text }) => {
    const notes = getInternalNotes();
    const note = {
      id: uuidv4(),
      contactKey,
      memberId,
      text,
      createdAt: new Date().toISOString(),
    };
    notes.push(note);
    saveInternalNotes(notes);

    const win = getMainWindow();
    if (win) win.webContents.send('internal-notes-updated', { contactKey, notes: notes.filter((n) => n.contactKey === contactKey) });
  });

  // Stats
  ipcMain.handle('get-team-stats', async () => {
    const assignments = getAssignments();
    const members = getTeamMembers();

    // Conversations per agent
    const perAgent = {};
    for (const member of members) {
      perAgent[member.id] = {
        name: member.name,
        open: 0,
        resolved: 0,
        pending: 0,
      };
    }

    let totalResolutionTime = 0;
    let resolvedCount = 0;
    let openCount = 0;

    for (const a of assignments) {
      if (perAgent[a.assignedTo]) {
        if (a.status === 'open') {
          perAgent[a.assignedTo].open++;
          openCount++;
        } else if (a.status === 'resolved') {
          perAgent[a.assignedTo].resolved++;
          if (a.resolvedAt && a.assignedAt) {
            totalResolutionTime += new Date(a.resolvedAt).getTime() - new Date(a.assignedAt).getTime();
            resolvedCount++;
          }
        } else if (a.status === 'pending') {
          perAgent[a.assignedTo].pending++;
        }
      } else if (a.status === 'open') {
        openCount++;
      }
    }

    const avgResolutionTime = resolvedCount > 0 ? Math.round(totalResolutionTime / resolvedCount / 1000) : 0;

    return {
      conversationsPerAgent: perAgent,
      avgResolutionTime, // in seconds
      openCount,
    };
  });

  ipcMain.handle('get-unassigned', async () => {
    const assignments = getAssignments();
    const assignedContacts = new Set(assignments.filter((a) => a.status !== 'resolved').map((a) => a.contactKey));
    // Return contact keys that have no active assignment
    // Since we don't have a full contact list here, return the set of assigned for filtering
    return { assignedContacts: Array.from(assignedContacts) };
  });

  // Collision Detection / Locks
  ipcMain.on('lock-conversation', (event, { contactKey, memberId }) => {
    const existingLock = conversationLocks[contactKey];
    if (existingLock && existingLock.memberId !== memberId) {
      // Already locked by another agent
      const win = getMainWindow();
      if (win) win.webContents.send('conversation-lock-rejected', { contactKey, lockedBy: existingLock.memberId });
      return;
    }
    conversationLocks[contactKey] = {
      memberId,
      lockedAt: new Date().toISOString(),
    };

    const win = getMainWindow();
    if (win) win.webContents.send('conversation-locked', { contactKey, memberId });
  });

  ipcMain.on('unlock-conversation', (event, { contactKey }) => {
    delete conversationLocks[contactKey];

    const win = getMainWindow();
    if (win) win.webContents.send('conversation-unlocked', { contactKey });
  });

  ipcMain.handle('get-locks', async () => {
    return { ...conversationLocks };
  });
}

module.exports = { initTeamInbox };
