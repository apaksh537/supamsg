// PostHog Analytics — comprehensive anonymous usage tracking
// Tracks: feature usage, errors, session duration, conversion funnel
// PostHog free tier: 1M events/month at posthog.com
// NEVER tracks: message content, contacts, personal data

const https = require('https');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

let analyticsPath;
let sessionStart;
let config = {
  enabled: true,
  posthogKey: '', // Set via settings or hardcode your key here
  distinctId: '',
};

function initPosthogAnalytics({ app, ipcMain }) {
  analyticsPath = path.join(app.getPath('userData'), 'analytics-config.json');
  loadConfig();
  sessionStart = Date.now();

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

  ipcMain.on('track-event', (_event, { eventName, properties }) => {
    trackEvent(eventName, properties);
  });

  // ── Auto-tracked events ──

  // App opened
  trackEvent('app_opened', {
    version: app.getVersion(),
    platform: process.platform,
    arch: process.arch,
    locale: app.getLocale(),
  });

  // Track panel opens
  ipcMain.on('open-panel', (_event, panelName) => {
    trackEvent('panel_opened', { panel: panelName });
  });

  // Track account switches
  ipcMain.on('switch-account', () => {
    trackEvent('account_switched');
  });

  // Track session duration on quit
  app.on('before-quit', () => {
    const duration = Math.round((Date.now() - sessionStart) / 1000);
    trackEvent('session_ended', {
      duration_seconds: duration,
      duration_minutes: Math.round(duration / 60),
    });
  });

  // Track errors
  process.on('uncaughtException', (error) => {
    trackEvent('error_uncaught', {
      message: error.message?.substring(0, 200),
      stack: error.stack?.substring(0, 500),
    });
  });

  process.on('unhandledRejection', (reason) => {
    trackEvent('error_unhandled_rejection', {
      message: String(reason)?.substring(0, 200),
    });
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
  }, () => {});

  req.on('error', () => {});
  req.write(payload);
  req.end();
}

// ── Events tracked across the app ──
//
// ACQUISITION:
//   app_opened          — every launch (version, platform)
//   session_ended       — duration of each session
//
// ENGAGEMENT:
//   account_added       — new WhatsApp account connected
//   account_removed     — account disconnected
//   account_switched    — switched between accounts
//   panel_opened        — which tool panel (schedule, ai, templates, etc.)
//
// CONVERSION:
//   upgrade_prompt_shown  — upgrade banner displayed
//   upgrade_panel_opened  — user clicked upgrade
//   license_activated     — successfully activated a key
//
// FEATURE USAGE:
//   message_scheduled   — scheduled a message
//   template_used       — inserted a template
//   ai_feature_used     — used AI (suggest/summarize/translate)
//   broadcast_started   — launched a broadcast campaign
//   chat_exported       — exported a chat
//
// ERRORS:
//   error_uncaught      — app crash
//   error_unhandled_rejection — async error
//   feature_init_failed — a feature module failed to load
//
// RETENTION:
//   app_opened tracks daily/weekly/monthly active users automatically
//   PostHog calculates retention cohorts from this

function loadConfig() {
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
