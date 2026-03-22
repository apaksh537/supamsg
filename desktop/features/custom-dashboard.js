const path = require('path');
const fs = require('fs');
const uuidv4 = () => require('crypto').randomUUID();

function initCustomDashboard({ app, ipcMain, getMainWindow, getViews, getActiveAccountId, getAccounts }) {
  const userDataPath = app.getPath('userData');
  const dashboardsPath = path.join(userDataPath, 'dashboards.json');

  const WIDGET_TYPES = [
    { type: 'message_volume', title: 'Message Volume', description: 'Line chart of messages over time', defaultSize: { w: 6, h: 4 } },
    { type: 'response_time', title: 'Response Time', description: 'Average response time gauge', defaultSize: { w: 3, h: 3 } },
    { type: 'top_contacts', title: 'Top Contacts', description: 'Table of most active contacts', defaultSize: { w: 6, h: 4 } },
    { type: 'unread_count', title: 'Unread Count', description: 'Big number showing total unread messages', defaultSize: { w: 3, h: 2 } },
    { type: 'sla_compliance', title: 'SLA Compliance', description: 'Pie chart of SLA response tiers', defaultSize: { w: 4, h: 4 } },
    { type: 'sentiment_overview', title: 'Sentiment Overview', description: 'Sentiment distribution across conversations', defaultSize: { w: 4, h: 3 } },
    { type: 'account_summary', title: 'Account Summary', description: 'Per-account statistics cards', defaultSize: { w: 6, h: 3 } },
    { type: 'kanban_funnel', title: 'Kanban Funnel', description: 'Conversion funnel from kanban pipeline data', defaultSize: { w: 6, h: 4 } },
    { type: 'recent_activity', title: 'Recent Activity', description: 'Live feed of recent messages', defaultSize: { w: 4, h: 5 } },
    { type: 'team_performance', title: 'Team Performance', description: 'Team leaderboard table', defaultSize: { w: 6, h: 4 } },
  ];

  // --- Helpers ---

  function readJSON(filePath, fallback = []) {
    try {
      if (fs.existsSync(filePath)) {
        return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
      }
    } catch (e) {
      console.error(`[custom-dashboard] Failed to read ${filePath}:`, e.message);
    }
    return fallback;
  }

  function writeJSON(filePath, data) {
    try {
      fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
    } catch (e) {
      console.error(`[custom-dashboard] Failed to write ${filePath}:`, e.message);
    }
  }

  function getDashboards() {
    return readJSON(dashboardsPath, []);
  }

  function saveDashboards(dashboards) {
    writeJSON(dashboardsPath, dashboards);
  }

  function readAnalytics(accountId) {
    const analyticsPath = path.join(userDataPath, 'analytics.json');
    const data = readJSON(analyticsPath, {});
    return accountId ? (data[accountId] || {}) : data;
  }

  function readKanban() {
    const kanbanPath = path.join(userDataPath, 'kanban.json');
    return readJSON(kanbanPath, {});
  }

  function readTeamMembers() {
    const p = path.join(userDataPath, 'team-members.json');
    return readJSON(p, []);
  }

  function readAssignments() {
    const p = path.join(userDataPath, 'assignments.json');
    return readJSON(p, []);
  }

  function readSentiment() {
    const p = path.join(userDataPath, 'sentiment-alerts.json');
    return readJSON(p, {});
  }

  // --- Widget Data Fetchers ---

  async function fetchWidgetData(widgetType, config) {
    const accountId = config.accountId || getActiveAccountId();
    const days = config.days || 30;

    switch (widgetType) {
      case 'message_volume': {
        const data = readAnalytics(accountId);
        const messages = data.messages || [];
        const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
        const filtered = messages.filter((m) => new Date(m.timestamp).getTime() >= cutoff);
        const daily = {};
        for (const msg of filtered) {
          const day = new Date(msg.timestamp).toISOString().split('T')[0];
          if (!daily[day]) daily[day] = { date: day, sent: 0, received: 0 };
          if (msg.direction === 'outgoing') daily[day].sent++;
          else daily[day].received++;
        }
        return { data: Object.values(daily).sort((a, b) => a.date.localeCompare(b.date)) };
      }

      case 'response_time': {
        const data = readAnalytics(accountId);
        const messages = data.messages || [];
        let totalTime = 0;
        let count = 0;
        const byContact = {};
        for (const m of messages) {
          const k = m.contactKey || m.contact;
          if (!k) continue;
          if (!byContact[k]) byContact[k] = [];
          byContact[k].push(m);
        }
        for (const msgs of Object.values(byContact)) {
          const sorted = msgs.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
          for (let i = 1; i < sorted.length; i++) {
            if (sorted[i - 1].direction === 'incoming' && sorted[i].direction === 'outgoing') {
              totalTime += new Date(sorted[i].timestamp).getTime() - new Date(sorted[i - 1].timestamp).getTime();
              count++;
            }
          }
        }
        return { avgResponseTime: count > 0 ? Math.round(totalTime / count / 1000) : 0, sampleSize: count };
      }

      case 'top_contacts': {
        const data = readAnalytics(accountId);
        const messages = data.messages || [];
        const limit = config.limit || 10;
        const counts = {};
        for (const m of messages) {
          const k = m.contactKey || m.contact;
          if (!k) continue;
          counts[k] = (counts[k] || 0) + 1;
        }
        const sorted = Object.entries(counts)
          .sort((a, b) => b[1] - a[1])
          .slice(0, limit)
          .map(([name, count]) => ({ contactName: name, messageCount: count }));
        return { contacts: sorted };
      }

      case 'unread_count': {
        const data = readAnalytics(accountId);
        return { unreadCount: data.unreadCount || 0 };
      }

      case 'sla_compliance': {
        const data = readAnalytics(accountId);
        const messages = data.messages || [];
        const byContact = {};
        for (const m of messages) {
          const k = m.contactKey || m.contact;
          if (!k) continue;
          if (!byContact[k]) byContact[k] = [];
          byContact[k].push(m);
        }
        let total = 0, w5 = 0, w15 = 0, w1h = 0, w24h = 0;
        for (const msgs of Object.values(byContact)) {
          const sorted = msgs.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
          for (let i = 1; i < sorted.length; i++) {
            if (sorted[i - 1].direction === 'incoming' && sorted[i].direction === 'outgoing') {
              const rt = new Date(sorted[i].timestamp).getTime() - new Date(sorted[i - 1].timestamp).getTime();
              total++;
              if (rt <= 5 * 60000) w5++;
              if (rt <= 15 * 60000) w15++;
              if (rt <= 3600000) w1h++;
              if (rt <= 86400000) w24h++;
            }
          }
        }
        const pct = (n) => (total > 0 ? Math.round((n / total) * 100) : 0);
        return { within5min: pct(w5), within15min: pct(w15), within1hr: pct(w1h), within24hr: pct(w24h), total };
      }

      case 'sentiment_overview': {
        const sentimentData = readSentiment();
        const contacts = sentimentData.contacts || {};
        const distribution = { positive: 0, neutral: 0, negative: 0 };
        for (const c of Object.values(contacts)) {
          const s = (c.sentiment || 'neutral').toLowerCase();
          if (s === 'positive') distribution.positive++;
          else if (s === 'negative') distribution.negative++;
          else distribution.neutral++;
        }
        return { distribution };
      }

      case 'account_summary': {
        const accounts = getAccounts();
        const summaries = [];
        for (const acc of accounts) {
          const accData = readAnalytics(acc.id || acc.phoneNumber);
          summaries.push({
            accountName: acc.name || acc.phoneNumber || acc.id,
            messageCount: (accData.messages || []).length,
            unread: accData.unreadCount || 0,
          });
        }
        return { accounts: summaries };
      }

      case 'kanban_funnel': {
        const kanban = readKanban();
        const stages = kanban.stages || kanban.columns || [];
        const funnel = [];
        for (const stage of stages) {
          const items = stage.items || stage.contacts || [];
          funnel.push({
            stage: stage.name || stage.title || 'Unknown',
            count: Array.isArray(items) ? items.length : 0,
          });
        }
        return { funnel };
      }

      case 'recent_activity': {
        const data = readAnalytics(accountId);
        const messages = (data.messages || [])
          .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))
          .slice(0, config.limit || 20);
        return { messages };
      }

      case 'team_performance': {
        const members = readTeamMembers();
        const assignments = readAssignments();
        const leaderboard = members.map((m) => {
          const mAssignments = assignments.filter((a) => a.assignedTo === m.id);
          const resolved = mAssignments.filter((a) => a.status === 'resolved');
          return {
            agentName: m.name,
            conversationsHandled: mAssignments.length,
            resolvedCount: resolved.length,
          };
        });
        return { leaderboard };
      }

      default:
        return { error: `Unknown widget type: ${widgetType}` };
    }
  }

  // --- IPC Handlers ---

  ipcMain.handle('get-dashboards', async () => {
    return getDashboards();
  });

  ipcMain.on('save-dashboard', (event, dashboard) => {
    const dashboards = getDashboards();
    if (!dashboard.id) {
      dashboard.id = uuidv4();
    }
    const idx = dashboards.findIndex((d) => d.id === dashboard.id);
    if (idx !== -1) {
      dashboards[idx] = dashboard;
    } else {
      dashboards.push(dashboard);
    }
    saveDashboards(dashboards);

    const win = getMainWindow();
    if (win) win.webContents.send('dashboards-updated', dashboards);
  });

  ipcMain.on('delete-dashboard', (event, { dashboardId }) => {
    let dashboards = getDashboards();
    dashboards = dashboards.filter((d) => d.id !== dashboardId);
    saveDashboards(dashboards);

    const win = getMainWindow();
    if (win) win.webContents.send('dashboards-updated', dashboards);
  });

  ipcMain.handle('get-widget-types', async () => {
    return WIDGET_TYPES;
  });

  ipcMain.handle('get-widget-data', async (event, { widgetType, config: widgetConfig }) => {
    try {
      return await fetchWidgetData(widgetType, widgetConfig || {});
    } catch (e) {
      console.error(`[custom-dashboard] Failed to fetch widget data for ${widgetType}:`, e.message);
      return { error: e.message };
    }
  });
}

module.exports = { initCustomDashboard };
