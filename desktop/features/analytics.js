// Analytics: track message activity per account
// Stores time-series data locally, renders in a dashboard panel

const path = require('path');
const fs = require('fs');

let analyticsPath;
let analytics = {
  // accountId -> { daily: { "2024-01-15": { received: 5, peak_hour: 14 } }, hourly: { "14": 23 } }
};

function initAnalytics({ app, ipcMain, getMainWindow }) {
  analyticsPath = path.join(app.getPath('userData'), 'analytics.json');
  loadAnalytics();

  ipcMain.handle('get-analytics', () => analytics);

  ipcMain.handle('get-analytics-summary', (_event, accountId) => {
    const data = accountId ? { [accountId]: analytics[accountId] } : analytics;
    return generateSummary(data);
  });
}

function loadAnalytics() {
  try {
    if (fs.existsSync(analyticsPath)) {
      analytics = JSON.parse(fs.readFileSync(analyticsPath, 'utf8'));
    }
  } catch (e) {
    analytics = {};
  }
}

function saveAnalytics() {
  fs.writeFileSync(analyticsPath, JSON.stringify(analytics, null, 2));
}

// Called from main.js when unread count changes (message received signal)
function recordActivity(accountId, unreadDelta) {
  if (!analytics[accountId]) {
    analytics[accountId] = { daily: {}, hourly: {} };
  }

  const now = new Date();
  const dateKey = now.toISOString().split('T')[0];
  const hourKey = String(now.getHours());

  // Daily
  if (!analytics[accountId].daily[dateKey]) {
    analytics[accountId].daily[dateKey] = { received: 0, active_hours: [] };
  }
  analytics[accountId].daily[dateKey].received += unreadDelta;
  if (!analytics[accountId].daily[dateKey].active_hours.includes(hourKey)) {
    analytics[accountId].daily[dateKey].active_hours.push(hourKey);
  }

  // Hourly aggregate
  if (!analytics[accountId].hourly[hourKey]) {
    analytics[accountId].hourly[hourKey] = 0;
  }
  analytics[accountId].hourly[hourKey] += unreadDelta;

  // Prune: keep only last 90 days
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - 90);
  const cutoffKey = cutoff.toISOString().split('T')[0];
  for (const dk of Object.keys(analytics[accountId].daily)) {
    if (dk < cutoffKey) delete analytics[accountId].daily[dk];
  }

  saveAnalytics();
}

function generateSummary(data) {
  const summary = {};

  for (const [accountId, acctData] of Object.entries(data)) {
    if (!acctData) continue;

    const dailyEntries = Object.entries(acctData.daily || {}).sort((a, b) => b[0].localeCompare(a[0]));

    // Last 7 days
    const last7 = dailyEntries.slice(0, 7);
    const totalWeek = last7.reduce((sum, [, d]) => sum + d.received, 0);

    // Last 30 days
    const last30 = dailyEntries.slice(0, 30);
    const totalMonth = last30.reduce((sum, [, d]) => sum + d.received, 0);

    // Peak hour
    const hourly = acctData.hourly || {};
    let peakHour = 0;
    let peakCount = 0;
    for (const [h, count] of Object.entries(hourly)) {
      if (count > peakCount) {
        peakHour = parseInt(h);
        peakCount = count;
      }
    }

    // Daily average
    const avgDaily = last30.length > 0 ? Math.round(totalMonth / last30.length) : 0;

    // Busiest day
    let busiestDay = null;
    let busiestCount = 0;
    for (const [day, d] of dailyEntries) {
      if (d.received > busiestCount) {
        busiestDay = day;
        busiestCount = d.received;
      }
    }

    summary[accountId] = {
      messagesThisWeek: totalWeek,
      messagesThisMonth: totalMonth,
      avgDailyMessages: avgDaily,
      peakHour: `${peakHour}:00`,
      peakHourMessages: peakCount,
      busiestDay,
      busiestDayMessages: busiestCount,
      totalDaysTracked: dailyEntries.length,
      last7Days: last7.map(([date, d]) => ({ date, received: d.received })),
      hourlyDistribution: Object.fromEntries(
        Array.from({ length: 24 }, (_, i) => [i, hourly[String(i)] || 0])
      ),
    };
  }

  return summary;
}

module.exports = { initAnalytics, recordActivity };
