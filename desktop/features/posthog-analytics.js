// PostHog Analytics — tracks feature usage, conversion events, and user behavior
// PostHog free tier: 1M events/month, no credit card required
// Sign up at posthog.com, get project API key

const https = require('https');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

let analyticsPath;
let config = {
  enabled: true,
  posthogKey: '', // Set via settings
  distinctId: '', // Anonymous device ID (generated once)
};

function initPosthogAnalytics({ app, ipcMain }) {
  analyticsPath = path.join(app.getPath('userData'), 'analytics-config.json');
  loadConfig(app);

  // Generate anonymous device ID if not exists
  if (!config.distinctId) {
    config.distinctId = crypto.randomUUID();
    saveConfig();
  }

  ipcMain.handle('get-analytics-config', () => ({ enabled: config.enabled, hasKey: !!config.posthogKey }));

  ipcMain.on('set-analytics-config', (_event, { enabled, posthogKey }) => {
    config.enabled = enabled;
    if (posthogKey) config.posthogKey = posthogKey;
    saveConfig();
  });

  // Track event
  ipcMain.on('track-event', (_event, { eventName, properties }) => {
    trackEvent(eventName, properties);
  });

  // Auto-track app lifecycle events
  trackEvent('app_opened', {
    version: app.getVersion(),
    platform: process.platform,
    arch: process.arch,
  });
}

function trackEvent(eventName, properties = {}) {
  if (!config.enabled || !config.posthogKey) return;

  const payload = JSON.stringify({
    api_key: config.posthogKey,
    event: eventName,
    properties: {
      distinct_id: config.distinctId,
      $lib: 'supamsg-electron',
      ...properties,
      timestamp: new Date().toISOString(),
    },
  });

  const req = https.request({
    hostname: 'us.i.posthog.com',
    path: '/capture/',
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(payload),
    },
  }, () => {}); // Fire and forget

  req.on('error', () => {}); // Silently fail
  req.write(payload);
  req.end();
}

// Key events to track (call these from other modules):
// - account_added, account_removed
// - feature_used (with feature_name property)
// - upgrade_prompt_shown, upgrade_clicked, upgrade_completed
// - mode_switched (whatsapp/simple/pro)
// - ai_feature_used (suggest/summarize/translate/draft)
// - scheduled_message_created, broadcast_started
// - license_activated, license_deactivated

function loadConfig(app) {
  try {
    if (fs.existsSync(analyticsPath)) {
      config = { ...config, ...JSON.parse(fs.readFileSync(analyticsPath, 'utf8')) };
    }
  } catch (e) {}
}

function saveConfig() {
  fs.writeFileSync(analyticsPath, JSON.stringify(config, null, 2));
}

module.exports = { initPosthogAnalytics, trackEvent };
