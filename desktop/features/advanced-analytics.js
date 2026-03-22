const path = require('path');
const fs = require('fs');

function initAdvancedAnalytics({ app, ipcMain, getMainWindow, getViews, getActiveAccountId, getAccounts }) {
  const userDataPath = app.getPath('userData');
  const slaConfigPath = path.join(userDataPath, 'sla-config.json');

  // --- Helpers ---

  function readJSON(filePath, fallback = null) {
    try {
      if (fs.existsSync(filePath)) {
        return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
      }
    } catch (e) {
      console.error(`[advanced-analytics] Failed to read ${filePath}:`, e.message);
    }
    return fallback;
  }

  function writeJSON(filePath, data) {
    try {
      fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
    } catch (e) {
      console.error(`[advanced-analytics] Failed to write ${filePath}:`, e.message);
    }
  }

  function getAnalyticsData(accountId) {
    const analyticsPath = path.join(userDataPath, 'analytics.json');
    const data = readJSON(analyticsPath, {});
    return accountId ? (data[accountId] || {}) : data;
  }

  function getKanbanData() {
    const kanbanPath = path.join(userDataPath, 'kanban.json');
    return readJSON(kanbanPath, {});
  }

  function getSLAConfig() {
    return readJSON(slaConfigPath, {
      thresholds: {
        fast: 5 * 60 * 1000,       // 5 minutes
        medium: 15 * 60 * 1000,     // 15 minutes
        slow: 60 * 60 * 1000,       // 1 hour
        max: 24 * 60 * 60 * 1000,   // 24 hours
      },
    });
  }

  function filterByDays(records, days, dateField = 'timestamp') {
    if (!days) return records;
    const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
    return (records || []).filter((r) => new Date(r[dateField]).getTime() >= cutoff);
  }

  // --- IPC Handlers ---

  ipcMain.handle('get-response-times', async (event, { accountId, days }) => {
    const data = getAnalyticsData(accountId);
    const messages = filterByDays(data.messages || [], days);

    const responseTimesByContact = {};

    // Group messages by contact and calculate response times
    const byContact = {};
    for (const msg of messages) {
      const key = msg.contactKey || msg.contact;
      if (!key) continue;
      if (!byContact[key]) byContact[key] = [];
      byContact[key].push(msg);
    }

    let totalResponseTime = 0;
    let responseCount = 0;
    let fastest = { contact: null, time: Infinity };
    let slowest = { contact: null, time: 0 };
    const byHour = {};

    for (const [contact, msgs] of Object.entries(byContact)) {
      const sorted = msgs.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
      let contactTotal = 0;
      let contactCount = 0;

      for (let i = 1; i < sorted.length; i++) {
        const prev = sorted[i - 1];
        const curr = sorted[i];
        // If previous was incoming and current is outgoing, that's a response
        if (prev.direction === 'incoming' && curr.direction === 'outgoing') {
          const responseTime = new Date(curr.timestamp).getTime() - new Date(prev.timestamp).getTime();
          contactTotal += responseTime;
          contactCount++;
          totalResponseTime += responseTime;
          responseCount++;

          const hour = new Date(curr.timestamp).getHours();
          byHour[hour] = (byHour[hour] || 0) + 1;
        }
      }

      if (contactCount > 0) {
        const avgTime = contactTotal / contactCount;
        responseTimesByContact[contact] = avgTime;
        if (avgTime < fastest.time) fastest = { contact, time: avgTime };
        if (avgTime > slowest.time) slowest = { contact, time: avgTime };
      }
    }

    return {
      avgResponseTime: responseCount > 0 ? Math.round(totalResponseTime / responseCount / 1000) : 0, // seconds
      fastestContact: fastest.contact ? { name: fastest.contact, time: Math.round(fastest.time / 1000) } : null,
      slowestContact: slowest.contact ? { name: slowest.contact, time: Math.round(slowest.time / 1000) } : null,
      byHour,
    };
  });

  ipcMain.handle('get-conversation-volume', async (event, { accountId, days }) => {
    const data = getAnalyticsData(accountId);
    const messages = filterByDays(data.messages || [], days);

    const daily = {};
    const weekly = {};
    const hourlyHeatmap = {};

    for (const msg of messages) {
      const date = new Date(msg.timestamp);
      const dayKey = date.toISOString().split('T')[0];
      const weekKey = getWeekKey(date);
      const dayOfWeek = date.getDay();
      const hour = date.getHours();

      // Daily
      if (!daily[dayKey]) daily[dayKey] = { date: dayKey, sent: 0, received: 0 };
      if (msg.direction === 'outgoing') daily[dayKey].sent++;
      else daily[dayKey].received++;

      // Weekly
      if (!weekly[weekKey]) weekly[weekKey] = { week: weekKey, sent: 0, received: 0 };
      if (msg.direction === 'outgoing') weekly[weekKey].sent++;
      else weekly[weekKey].received++;

      // Hourly heatmap
      if (!hourlyHeatmap[dayOfWeek]) hourlyHeatmap[dayOfWeek] = {};
      hourlyHeatmap[dayOfWeek][hour] = (hourlyHeatmap[dayOfWeek][hour] || 0) + 1;
    }

    return {
      daily: Object.values(daily).sort((a, b) => a.date.localeCompare(b.date)),
      weekly: Object.values(weekly).sort((a, b) => a.week.localeCompare(b.week)),
      hourlyHeatmap,
    };
  });

  ipcMain.handle('get-top-contacts', async (event, { accountId, days, limit }) => {
    const data = getAnalyticsData(accountId);
    const messages = filterByDays(data.messages || [], days);
    const contactLimit = limit || 10;

    const byContact = {};
    for (const msg of messages) {
      const key = msg.contactKey || msg.contact;
      if (!key) continue;
      if (!byContact[key]) {
        byContact[key] = { contactName: key, messageCount: 0, lastActive: null, responseTimes: [] };
      }
      byContact[key].messageCount++;
      const ts = msg.timestamp;
      if (!byContact[key].lastActive || ts > byContact[key].lastActive) {
        byContact[key].lastActive = ts;
      }
    }

    const sorted = Object.values(byContact)
      .sort((a, b) => b.messageCount - a.messageCount)
      .slice(0, contactLimit);

    return sorted.map((c) => ({
      contactName: c.contactName,
      messageCount: c.messageCount,
      lastActive: c.lastActive,
      avgResponseTime: 0,
    }));
  });

  ipcMain.handle('get-sla-report', async (event, { accountId, days }) => {
    const data = getAnalyticsData(accountId);
    const messages = filterByDays(data.messages || [], days);

    const byContact = {};
    for (const msg of messages) {
      const key = msg.contactKey || msg.contact;
      if (!key) continue;
      if (!byContact[key]) byContact[key] = [];
      byContact[key].push(msg);
    }

    let total = 0;
    let within5min = 0;
    let within15min = 0;
    let within1hr = 0;
    let within24hr = 0;

    for (const [, msgs] of Object.entries(byContact)) {
      const sorted = msgs.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
      for (let i = 1; i < sorted.length; i++) {
        const prev = sorted[i - 1];
        const curr = sorted[i];
        if (prev.direction === 'incoming' && curr.direction === 'outgoing') {
          const responseTime = new Date(curr.timestamp).getTime() - new Date(prev.timestamp).getTime();
          total++;
          if (responseTime <= 5 * 60 * 1000) within5min++;
          if (responseTime <= 15 * 60 * 1000) within15min++;
          if (responseTime <= 60 * 60 * 1000) within1hr++;
          if (responseTime <= 24 * 60 * 60 * 1000) within24hr++;
        }
      }
    }

    const pct = (count) => (total > 0 ? Math.round((count / total) * 100) : 0);

    return {
      within5min: pct(within5min),
      within15min: pct(within15min),
      within1hr: pct(within1hr),
      within24hr: pct(within24hr),
      totalResponses: total,
    };
  });

  ipcMain.handle('get-conversation-funnel', async (event, { accountId }) => {
    const kanban = getKanbanData();
    const stages = kanban.stages || kanban.columns || [];

    const funnel = {
      newLeads: 0,
      contacted: 0,
      qualified: 0,
      proposalSent: 0,
      closedWon: 0,
      closedLost: 0,
    };

    const stageMapping = {
      'new': 'newLeads',
      'new leads': 'newLeads',
      'lead': 'newLeads',
      'contacted': 'contacted',
      'qualified': 'qualified',
      'proposal': 'proposalSent',
      'proposal sent': 'proposalSent',
      'won': 'closedWon',
      'closed won': 'closedWon',
      'lost': 'closedLost',
      'closed lost': 'closedLost',
    };

    if (Array.isArray(stages)) {
      for (const stage of stages) {
        const name = (stage.name || stage.title || '').toLowerCase();
        const items = stage.items || stage.contacts || [];
        const count = Array.isArray(items) ? items.length : 0;
        const mappedKey = stageMapping[name];
        if (mappedKey) {
          funnel[mappedKey] += count;
        }
      }
    }

    return funnel;
  });

  ipcMain.handle('get-team-leaderboard', async () => {
    const teamMembersPath = path.join(userDataPath, 'team-members.json');
    const assignmentsPath = path.join(userDataPath, 'assignments.json');
    const members = readJSON(teamMembersPath, []);
    const assignments = readJSON(assignmentsPath, []);

    return members.map((member) => {
      const memberAssignments = assignments.filter((a) => a.assignedTo === member.id);
      const resolved = memberAssignments.filter((a) => a.status === 'resolved');
      let totalResponseTime = 0;
      let responseCount = 0;

      for (const a of resolved) {
        if (a.resolvedAt && a.assignedAt) {
          totalResponseTime += new Date(a.resolvedAt).getTime() - new Date(a.assignedAt).getTime();
          responseCount++;
        }
      }

      return {
        agentName: member.name,
        conversationsHandled: memberAssignments.length,
        avgResponseTime: responseCount > 0 ? Math.round(totalResponseTime / responseCount / 1000) : 0,
        resolvedCount: resolved.length,
        csat: null, // CSAT not yet implemented
      };
    });
  });

  ipcMain.handle('export-analytics-report', async (event, { accountId, days, format }) => {
    const data = getAnalyticsData(accountId);
    const messages = filterByDays(data.messages || [], days);

    if (format === 'csv') {
      const headers = 'Timestamp,Direction,Contact,Message\n';
      const rows = messages.map((m) => {
        const ts = m.timestamp || '';
        const dir = m.direction || '';
        const contact = (m.contactKey || m.contact || '').replace(/,/g, ';');
        const text = (m.text || m.body || '').replace(/,/g, ';').replace(/\n/g, ' ');
        return `${ts},${dir},${contact},${text}`;
      }).join('\n');
      return headers + rows;
    }

    // Text format
    const lines = [];
    lines.push(`Analytics Report — Last ${days || 'all'} days`);
    lines.push(`Total messages: ${messages.length}`);
    lines.push(`Sent: ${messages.filter((m) => m.direction === 'outgoing').length}`);
    lines.push(`Received: ${messages.filter((m) => m.direction === 'incoming').length}`);
    lines.push('');

    const contacts = new Set(messages.map((m) => m.contactKey || m.contact).filter(Boolean));
    lines.push(`Unique contacts: ${contacts.size}`);

    return lines.join('\n');
  });

  // --- Utility ---

  function getWeekKey(date) {
    const d = new Date(date);
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() - d.getDay());
    return d.toISOString().split('T')[0];
  }
}

module.exports = { initAdvancedAnalytics };
