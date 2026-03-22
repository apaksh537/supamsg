// Real-time conversation sentiment monitoring
// Keyword-based sentiment scoring with alerts for negative/urgent messages

const path = require('path');
const fs = require('fs');
const { Notification } = require('electron');

const NEGATIVE_WORDS = [
  'angry', 'frustrated', 'terrible', 'worst', 'hate', 'cancel', 'refund',
  'disappointed', 'unacceptable', 'ridiculous', 'waste', 'horrible', 'awful',
  'disgusting', 'furious', 'complaint',
];

const POSITIVE_WORDS = [
  'thank', 'great', 'excellent', 'amazing', 'wonderful', 'perfect', 'love',
  'happy', 'appreciate', 'fantastic', 'brilliant', 'awesome', 'superb', 'delighted',
];

const URGENT_WORDS = [
  'urgent', 'asap', 'emergency', 'immediately', 'critical', 'deadline', 'help',
];

let alertsPath;
let alerts = [];
let monitoringEnabled = {}; // accountId -> boolean
let alertThreshold = -0.5;

function analyzeSentiment(text) {
  if (!text || typeof text !== 'string') {
    return { score: 0, sentiment: 'neutral', keywords: [] };
  }

  const lower = text.toLowerCase();
  const words = lower.split(/\s+/);
  const foundKeywords = [];
  let positiveCount = 0;
  let negativeCount = 0;
  let urgentCount = 0;

  for (const word of words) {
    const cleaned = word.replace(/[^a-z]/g, '');
    if (NEGATIVE_WORDS.includes(cleaned)) {
      negativeCount++;
      foundKeywords.push(cleaned);
    }
    if (POSITIVE_WORDS.includes(cleaned)) {
      positiveCount++;
      foundKeywords.push(cleaned);
    }
    if (URGENT_WORDS.includes(cleaned)) {
      urgentCount++;
      foundKeywords.push(cleaned);
    }
  }

  const total = positiveCount + negativeCount + urgentCount;
  let score = 0;
  if (total > 0) {
    score = (positiveCount - negativeCount - urgentCount * 0.5) / total;
    score = Math.max(-1, Math.min(1, score));
  }

  let sentiment = 'neutral';
  if (urgentCount > 0 && negativeCount === 0 && positiveCount === 0) {
    sentiment = 'urgent';
  } else if (urgentCount > 0 && negativeCount > 0) {
    sentiment = 'urgent';
  } else if (score < -0.2) {
    sentiment = 'negative';
  } else if (score > 0.2) {
    sentiment = 'positive';
  }

  return { score: Math.round(score * 100) / 100, sentiment, keywords: [...new Set(foundKeywords)] };
}

function initSentimentAlerts({ app, ipcMain, getMainWindow }) {
  alertsPath = path.join(app.getPath('userData'), 'sentiment-alerts.json');
  loadAlerts();

  ipcMain.on('enable-sentiment-monitoring', (_event, { accountId, enabled }) => {
    monitoringEnabled[accountId] = enabled;
  });

  ipcMain.handle('get-sentiment-alerts', () => {
    return alerts;
  });

  ipcMain.on('dismiss-alert', (_event, { alertId }) => {
    const alert = alerts.find((a) => a.id === alertId);
    if (alert) {
      alert.dismissed = true;
      saveAlerts();
    }
  });

  ipcMain.on('set-alert-threshold', (_event, { threshold }) => {
    alertThreshold = typeof threshold === 'number' ? threshold : -0.5;
  });

  // Expose a method for other modules to feed messages for analysis
  ipcMain.on('analyze-message-sentiment', (_event, { accountId, contactKey, text }) => {
    if (!monitoringEnabled[accountId]) return;

    const result = analyzeSentiment(text);
    if (result.sentiment === 'negative' || result.sentiment === 'urgent' || result.score <= alertThreshold) {
      const alert = {
        id: `alert-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        accountId,
        contactKey,
        text: text.substring(0, 200),
        score: result.score,
        sentiment: result.sentiment,
        keywords: result.keywords,
        dismissed: false,
        createdAt: new Date().toISOString(),
      };

      alerts.unshift(alert);
      // Keep last 100 alerts
      if (alerts.length > 100) {
        alerts = alerts.slice(0, 100);
      }
      saveAlerts();

      // Send IPC to main window
      const mainWindow = getMainWindow();
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('sentiment-alert', {
          contactKey,
          sentiment: result.sentiment,
          score: result.score,
          text: text.substring(0, 200),
        });
      }

      // Trigger native notification for urgent/negative
      if (Notification.isSupported()) {
        const notif = new Notification({
          title: result.sentiment === 'urgent' ? 'Urgent Message Alert' : 'Negative Sentiment Alert',
          body: `${contactKey}: ${text.substring(0, 100)}`,
          urgency: result.sentiment === 'urgent' ? 'critical' : 'normal',
        });
        notif.show();
      }
    }
  });
}

function loadAlerts() {
  try {
    if (fs.existsSync(alertsPath)) {
      alerts = JSON.parse(fs.readFileSync(alertsPath, 'utf8'));
    }
  } catch (e) {
    alerts = [];
  }
}

function saveAlerts() {
  try {
    fs.writeFileSync(alertsPath, JSON.stringify(alerts, null, 2), 'utf8');
  } catch (e) {
    console.error('Failed to save sentiment alerts:', e);
  }
}

module.exports = { initSentimentAlerts, analyzeSentiment };
