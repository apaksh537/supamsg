// Smart Outreach Engine — intelligent WhatsApp outreach with multi-account rotation,
// anti-ban protection, warm-up logic, health scoring, and timezone-aware scheduling.

const path = require('path');
const fs = require('fs');

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const PHONE_TIMEZONE_MAP = {
  '+91':  'Asia/Kolkata',
  '+1':   'America/New_York',
  '+44':  'Europe/London',
  '+971': 'Asia/Dubai',
  '+65':  'Asia/Singapore',
  '+55':  'America/Sao_Paulo',
  '+52':  'America/Mexico_City',
  '+62':  'Asia/Jakarta',
  '+234': 'Africa/Lagos',
  '+254': 'Africa/Nairobi',
  '+86':  'Asia/Shanghai',
  '+81':  'Asia/Tokyo',
};

// Sorted longest-prefix-first so "+971" matches before "+9"
const SORTED_PREFIXES = Object.keys(PHONE_TIMEZONE_MAP).sort(
  (a, b) => b.length - a.length,
);

const REPLY_CHECK_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes
const DAILY_HISTORY_KEEP_DAYS = 7;

// ---------------------------------------------------------------------------
// Module state
// ---------------------------------------------------------------------------

let campaignsPath;
let healthPath;
let campaigns = [];
let numberHealth = {};
let activeCampaigns = {};     // campaignId -> { paused, stopped }
let replyCheckTimers = {};    // campaignId -> intervalId
let lastResetDate = null;     // 'YYYY-MM-DD' of last daily reset

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function now() {
  return new Date();
}

function todayDateStr() {
  return now().toISOString().slice(0, 10);
}

function log(tag, ...args) {
  console.log(`[SmartOutreach][${tag}]`, ...args);
}

function logError(tag, ...args) {
  console.error(`[SmartOutreach][${tag}]`, ...args);
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function generateId() {
  return `outreach-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

// ---------------------------------------------------------------------------
// Persistence
// ---------------------------------------------------------------------------

function loadCampaigns() {
  try {
    if (fs.existsSync(campaignsPath)) {
      campaigns = JSON.parse(fs.readFileSync(campaignsPath, 'utf8'));
      // Auto-pause any campaigns that were running when the app last closed
      for (const c of campaigns) {
        if (c.status === 'running') {
          c.status = 'paused';
        }
      }
    }
  } catch (err) {
    logError('loadCampaigns', 'Failed to load campaigns:', err.message);
    campaigns = [];
  }
}

function saveCampaigns() {
  try {
    fs.writeFileSync(campaignsPath, JSON.stringify(campaigns, null, 2));
  } catch (err) {
    logError('saveCampaigns', 'Failed to persist campaigns:', err.message);
  }
}

function loadHealth() {
  try {
    if (fs.existsSync(healthPath)) {
      numberHealth = JSON.parse(fs.readFileSync(healthPath, 'utf8'));
    }
  } catch (err) {
    logError('loadHealth', 'Failed to load number health:', err.message);
    numberHealth = {};
  }
}

function saveHealth() {
  try {
    fs.writeFileSync(healthPath, JSON.stringify(numberHealth, null, 2));
  } catch (err) {
    logError('saveHealth', 'Failed to persist number health:', err.message);
  }
}

// ---------------------------------------------------------------------------
// IPC event helpers
// ---------------------------------------------------------------------------

function sendToWindow(getMainWindow, channel, data) {
  try {
    const win = getMainWindow();
    if (win && !win.isDestroyed()) {
      win.webContents.send(channel, data);
    }
  } catch (_) {
    // Window may have been destroyed; safe to ignore.
  }
}

function broadcastCampaigns(getMainWindow) {
  sendToWindow(getMainWindow, 'outreach-campaigns-updated', campaigns);
}

function sendProgress(getMainWindow, campaign) {
  sendToWindow(getMainWindow, 'outreach-progress', campaign);
}

function sendHealthUpdate(getMainWindow) {
  sendToWindow(getMainWindow, 'number-health-updated', numberHealth);
}

// ---------------------------------------------------------------------------
// Campaign stats recalculation
// ---------------------------------------------------------------------------

function recalcStats(campaign) {
  const stats = { sent: 0, failed: 0, replied: 0, pending: 0, total: campaign.contacts.length };
  for (const c of campaign.contacts) {
    if (c.status === 'sent')        stats.sent++;
    else if (c.status === 'failed') stats.failed++;
    else if (c.status === 'replied') stats.replied++;
    else if (c.status === 'pending' || c.status === 'queued_later') stats.pending++;
  }
  campaign.stats = stats;
}

// ---------------------------------------------------------------------------
// Timezone helpers
// ---------------------------------------------------------------------------

function getTimezoneForPhone(phone) {
  if (!phone) return Intl.DateTimeFormat().resolvedOptions().timeZone;
  const cleaned = phone.replace(/\s+/g, '');
  for (const prefix of SORTED_PREFIXES) {
    if (cleaned.startsWith(prefix)) {
      return PHONE_TIMEZONE_MAP[prefix];
    }
  }
  return Intl.DateTimeFormat().resolvedOptions().timeZone;
}

function getHourInTimezone(tz) {
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      hour: 'numeric',
      hour12: false,
    }).formatToParts(now());
    const hourPart = parts.find((p) => p.type === 'hour');
    return hourPart ? parseInt(hourPart.value, 10) : null;
  } catch {
    return null;
  }
}

function isWithinBusinessHours(phone, settings) {
  if (!settings.businessHoursOnly) return true;
  const tz = getTimezoneForPhone(phone);
  const hour = getHourInTimezone(tz);
  if (hour === null) return true; // cannot determine — allow sending
  return hour >= settings.businessHoursStart && hour < settings.businessHoursEnd;
}

// ---------------------------------------------------------------------------
// Number health helpers
// ---------------------------------------------------------------------------

function ensureHealthEntry(accountId) {
  if (!numberHealth[accountId]) {
    numberHealth[accountId] = {
      accountId,
      healthScore: 100,
      sentToday: 0,
      sentThisWeek: 0,
      totalSent: 0,
      totalReplies: 0,
      responseRate: 0,
      lastSentAt: null,
      firstUsedAt: null,
      warnings: 0,
      paused: false,
      pausedReason: null,
      dailyHistory: [],
    };
  }
  return numberHealth[accountId];
}

function calculateHealthScore(health, dailyLimit) {
  const usageToday = dailyLimit > 0 ? (health.sentToday / dailyLimit) : 0;
  let score = 100;
  score -= usageToday * 30;
  score -= health.warnings * 25;
  score -= Math.max(0, (50 - health.responseRate) * 0.5);
  if (health.responseRate > 30) score += 10;
  return clamp(Math.round(score * 100) / 100, 0, 100);
}

function updateResponseRate(health) {
  if (health.totalSent > 0) {
    health.responseRate = Math.round((health.totalReplies / health.totalSent) * 10000) / 100;
  } else {
    health.responseRate = 0;
  }
}

function getEffectiveDailyLimit(accountId, settings) {
  const health = ensureHealthEntry(accountId);
  if (!settings.warmupEnabled || !health.firstUsedAt) {
    return settings.dailyLimitPerNumber;
  }
  const daysSinceFirstUse = (Date.now() - new Date(health.firstUsedAt).getTime()) / 86400000;
  if (daysSinceFirstUse >= settings.warmupDaysToFull) {
    return settings.dailyLimitPerNumber;
  }
  const rampedLimit =
    settings.warmupStartLimit +
    (settings.dailyLimitPerNumber - settings.warmupStartLimit) *
      (daysSinceFirstUse / settings.warmupDaysToFull);
  return Math.floor(rampedLimit);
}

// ---------------------------------------------------------------------------
// Daily reset
// ---------------------------------------------------------------------------

function performDailyResetIfNeeded() {
  const today = todayDateStr();
  if (lastResetDate === today) return;

  log('dailyReset', `Resetting daily counters (last reset: ${lastResetDate || 'never'})`);
  lastResetDate = today;

  for (const accountId of Object.keys(numberHealth)) {
    const h = numberHealth[accountId];
    // Archive yesterday
    if (h.sentToday > 0 || (h.dailyHistory.length > 0 && h.dailyHistory[h.dailyHistory.length - 1]?.date !== today)) {
      h.dailyHistory.push({
        date: lastResetDate || today,
        sent: h.sentToday,
        replies: 0, // will be filled by reply tracking
      });
      // Keep only last N days
      if (h.dailyHistory.length > DAILY_HISTORY_KEEP_DAYS) {
        h.dailyHistory = h.dailyHistory.slice(-DAILY_HISTORY_KEEP_DAYS);
      }
    }
    h.sentToday = 0;

    // Recalculate weekly sent
    const weekAgo = new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10);
    h.sentThisWeek = h.dailyHistory
      .filter((d) => d.date >= weekAgo)
      .reduce((sum, d) => sum + d.sent, 0);
  }

  // Re-queue any contacts that were deferred
  for (const campaign of campaigns) {
    if (campaign.status === 'paused' || campaign.status === 'running') {
      for (const contact of campaign.contacts) {
        if (contact.status === 'queued_later') {
          contact.status = 'pending';
        }
      }
      recalcStats(campaign);
    }
  }

  saveHealth();
  saveCampaigns();
}

// ---------------------------------------------------------------------------
// Account selection
// ---------------------------------------------------------------------------

function selectBestAccount(campaign) {
  const { accountIds, settings } = campaign;
  let bestAccount = null;
  let bestScore = -Infinity;

  for (const accountId of accountIds) {
    const health = ensureHealthEntry(accountId);
    if (health.paused) continue;

    const effectiveLimit = getEffectiveDailyLimit(accountId, settings);
    if (health.sentToday >= effectiveLimit) continue;

    // Score: prioritise low usage ratio + high health
    const usageRatio = effectiveLimit > 0 ? health.sentToday / effectiveLimit : 1;
    const score = health.healthScore - usageRatio * 100;

    if (score > bestScore) {
      bestScore = score;
      bestAccount = accountId;
    }
  }

  return bestAccount;
}

// ---------------------------------------------------------------------------
// Message template personalisation
// ---------------------------------------------------------------------------

function personaliseMessage(template, contact) {
  return template
    .replace(/\{name\}/g, contact.name || '')
    .replace(/\{company\}/g, contact.company || '')
    .replace(/\{custom1\}/g, contact.custom1 || '')
    .replace(/\{custom2\}/g, contact.custom2 || '');
}

// ---------------------------------------------------------------------------
// WhatsApp Web JS injection — send message via a specific account view
// ---------------------------------------------------------------------------

async function sendMessageViaView(view, contact, message) {
  if (!view || !view.webContents) {
    return { success: false, error: 'View not available' };
  }

  const phone = (contact.phone || '').replace(/[^0-9+]/g, '');
  if (!phone) {
    return { success: false, error: 'Invalid phone number' };
  }

  try {
    const result = await view.webContents.executeJavaScript(`
      (async () => {
        try {
          const phone = ${JSON.stringify(phone)};
          const message = ${JSON.stringify(message)};

          // Click the search / new chat button
          const searchBox = document.querySelector('[data-testid="chat-list-search"]') ||
                            document.querySelector('[contenteditable="true"][data-tab="3"]');
          if (!searchBox) return { success: false, error: 'Search box not found' };

          // Focus and type into search
          searchBox.focus();
          searchBox.textContent = '';
          document.execCommand('insertText', false, phone);

          // Wait for search results
          await new Promise(r => setTimeout(r, 2500));

          // Click first matching result
          const results = document.querySelectorAll('[data-testid="cell-frame-container"]');
          if (results.length === 0) return { success: false, error: 'Contact not found: ' + phone };
          results[0].click();

          // Wait for chat to open
          await new Promise(r => setTimeout(r, 1500));

          // Find message input and type
          const msgInput = document.querySelector('[data-testid="conversation-compose-box-input"]') ||
                           document.querySelector('footer [contenteditable="true"]');
          if (!msgInput) return { success: false, error: 'Message input not found' };

          msgInput.focus();
          document.execCommand('insertText', false, message);

          // Click send
          await new Promise(r => setTimeout(r, 500));
          const sendBtn = document.querySelector('[data-testid="send"]') ||
                          document.querySelector('footer button[aria-label="Send"]');
          if (sendBtn) {
            sendBtn.click();
            return { success: true };
          }

          // Fallback: press Enter
          msgInput.dispatchEvent(new KeyboardEvent('keydown', {
            key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true
          }));
          return { success: true, method: 'enter-key' };
        } catch (err) {
          return { success: false, error: err.message || String(err) };
        }
      })();
    `);
    return result || { success: false, error: 'No result from executeJavaScript' };
  } catch (err) {
    return { success: false, error: err.message || String(err) };
  }
}

// ---------------------------------------------------------------------------
// Reply detection — lightweight JS check
// ---------------------------------------------------------------------------

async function checkForReply(view, phone) {
  if (!view || !view.webContents) return false;
  try {
    const replied = await view.webContents.executeJavaScript(`
      (async () => {
        try {
          const phone = ${JSON.stringify(phone)};

          // Navigate to the contact chat via search
          const searchBox = document.querySelector('[data-testid="chat-list-search"]') ||
                            document.querySelector('[contenteditable="true"][data-tab="3"]');
          if (!searchBox) return false;

          searchBox.focus();
          searchBox.textContent = '';
          document.execCommand('insertText', false, phone);

          await new Promise(r => setTimeout(r, 2000));

          const results = document.querySelectorAll('[data-testid="cell-frame-container"]');
          if (results.length === 0) return false;
          results[0].click();

          await new Promise(r => setTimeout(r, 1500));

          // Check if the last message is incoming (not ours)
          const msgs = document.querySelectorAll('[data-testid="msg-container"]');
          if (msgs.length === 0) return false;
          const lastMsg = msgs[msgs.length - 1];
          // Outgoing messages have the "message-out" class/attribute
          const isOutgoing = lastMsg.querySelector('[data-testid="msg-dblcheck"]') ||
                             lastMsg.querySelector('[data-testid="msg-check"]') ||
                             lastMsg.classList.contains('message-out');
          return !isOutgoing;
        } catch {
          return false;
        }
      })();
    `);
    return !!replied;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Reply tracking loop
// ---------------------------------------------------------------------------

function startReplyTracking(campaign, getViews, getMainWindow) {
  if (replyCheckTimers[campaign.id]) return;

  const intervalId = setInterval(async () => {
    // Stop if campaign no longer exists or is completed/deleted
    const c = campaigns.find((x) => x.id === campaign.id);
    if (!c || c.status === 'completed' || c.status === 'draft') {
      clearInterval(intervalId);
      delete replyCheckTimers[campaign.id];
      return;
    }

    const views = getViews();
    const sentContacts = c.contacts.filter((ct) => ct.status === 'sent');

    for (const contact of sentContacts) {
      if (!contact.assignedAccount) continue;
      const view = views[contact.assignedAccount];
      if (!view) continue;

      try {
        const replied = await checkForReply(view, contact.phone);
        if (replied) {
          contact.status = 'replied';
          contact.repliedAt = new Date().toISOString();

          // Update campaign stats
          recalcStats(c);

          // Update number health
          const health = ensureHealthEntry(contact.assignedAccount);
          health.totalReplies++;
          updateResponseRate(health);
          health.healthScore = calculateHealthScore(health, c.settings.dailyLimitPerNumber);
          saveHealth();
          sendHealthUpdate(getMainWindow);

          saveCampaigns();
          sendProgress(getMainWindow, c);
          log('replyTracker', `Reply detected from ${contact.phone} via ${contact.assignedAccount}`);
        }
      } catch (err) {
        logError('replyTracker', `Error checking reply for ${contact.phone}:`, err.message);
      }
    }
  }, REPLY_CHECK_INTERVAL_MS);

  replyCheckTimers[campaign.id] = intervalId;
}

function stopReplyTracking(campaignId) {
  if (replyCheckTimers[campaignId]) {
    clearInterval(replyCheckTimers[campaignId]);
    delete replyCheckTimers[campaignId];
  }
}

// ---------------------------------------------------------------------------
// Core outreach runner
// ---------------------------------------------------------------------------

async function runSmartOutreach(campaign, getViews, getMainWindow) {
  const { settings } = campaign;

  log('run', `Starting outreach for campaign "${campaign.name}" (${campaign.id})`);

  // Start reply tracking for this campaign
  startReplyTracking(campaign, getViews, getMainWindow);

  // Get pending contacts
  const pendingContacts = campaign.contacts.filter(
    (c) => c.status === 'pending' || c.status === 'queued_later',
  );

  if (pendingContacts.length === 0) {
    log('run', 'No pending contacts, marking campaign completed');
    campaign.status = 'completed';
    campaign.completedAt = new Date().toISOString();
    delete activeCampaigns[campaign.id];
    saveCampaigns();
    sendProgress(getMainWindow, campaign);
    return;
  }

  for (const contact of pendingContacts) {
    // Reset queued_later contacts back to pending for processing
    if (contact.status === 'queued_later') {
      contact.status = 'pending';
    }

    // Check if paused or stopped
    if (!activeCampaigns[campaign.id] || activeCampaigns[campaign.id].paused || activeCampaigns[campaign.id].stopped) {
      log('run', 'Campaign paused or stopped, exiting loop');
      return;
    }

    // Perform daily reset if needed
    performDailyResetIfNeeded();

    // Business hours check for recipient timezone
    if (!isWithinBusinessHours(contact.phone, settings)) {
      contact.status = 'queued_later';
      log('run', `Queued ${contact.phone} for later (outside business hours in recipient timezone)`);
      recalcStats(campaign);
      saveCampaigns();
      sendProgress(getMainWindow, campaign);
      continue;
    }

    // Select best account
    const accountId = selectBestAccount(campaign);
    if (!accountId) {
      log('run', 'All accounts at daily limit — pausing campaign until next day');
      campaign.status = 'paused';
      // Mark remaining pending contacts as queued_later
      for (const rc of campaign.contacts) {
        if (rc.status === 'pending') rc.status = 'queued_later';
      }
      recalcStats(campaign);
      activeCampaigns[campaign.id] = { paused: true, stopped: false };
      saveCampaigns();
      sendProgress(getMainWindow, campaign);
      return;
    }

    // Get the view for the selected account
    const views = getViews();
    const view = views[accountId];
    if (!view) {
      logError('run', `View not available for account ${accountId}, marking contact failed`);
      contact.status = 'failed';
      contact.assignedAccount = accountId;
      recalcStats(campaign);
      saveCampaigns();
      sendProgress(getMainWindow, campaign);
      continue;
    }

    // Human-like delay
    const baseDelay = settings.minDelay + Math.random() * (settings.maxDelay - settings.minDelay);
    let totalDelay = baseDelay;

    // 10% chance of an extra-long "break" pause (2–5 minutes)
    if (Math.random() < 0.1) {
      const breakDelay = 120 + Math.random() * 180; // 120-300 seconds
      totalDelay += breakDelay;
      log('run', `Simulating human break — extra ${Math.round(breakDelay)}s delay`);
    }

    log('run', `Waiting ${Math.round(totalDelay)}s before sending to ${contact.phone} via ${accountId}`);
    await sleep(totalDelay * 1000);

    // Re-check pause after delay
    if (!activeCampaigns[campaign.id] || activeCampaigns[campaign.id].paused || activeCampaigns[campaign.id].stopped) {
      log('run', 'Campaign paused/stopped after delay, exiting');
      return;
    }

    // Personalise and send
    const message = personaliseMessage(campaign.message, contact);
    const result = await sendMessageViaView(view, contact, message);

    if (result.success) {
      contact.status = 'sent';
      contact.assignedAccount = accountId;
      contact.sentAt = new Date().toISOString();
      log('run', `Sent to ${contact.phone} via ${accountId}`);

      // Update health
      const health = ensureHealthEntry(accountId);
      health.sentToday++;
      health.sentThisWeek++;
      health.totalSent++;
      health.lastSentAt = new Date().toISOString();
      if (!health.firstUsedAt) {
        health.firstUsedAt = new Date().toISOString();
      }
      health.healthScore = calculateHealthScore(health, getEffectiveDailyLimit(accountId, settings));
      saveHealth();
      sendHealthUpdate(getMainWindow);
    } else {
      contact.status = 'failed';
      contact.assignedAccount = accountId;
      logError('run', `Failed to send to ${contact.phone}: ${result.error}`);
    }

    recalcStats(campaign);
    saveCampaigns();
    sendProgress(getMainWindow, campaign);
  }

  // Check if all contacts are processed
  const remaining = campaign.contacts.filter((c) => c.status === 'pending' || c.status === 'queued_later');
  if (remaining.length === 0) {
    campaign.status = 'completed';
    campaign.completedAt = new Date().toISOString();
    delete activeCampaigns[campaign.id];
    log('run', `Campaign "${campaign.name}" completed`);
  } else {
    log('run', `Campaign "${campaign.name}" — ${remaining.length} contacts queued for later`);
  }

  saveCampaigns();
  sendProgress(getMainWindow, campaign);
}

// ---------------------------------------------------------------------------
// Aggregated stats
// ---------------------------------------------------------------------------

function getAggregatedStats() {
  const result = {
    totalCampaigns: campaigns.length,
    activeCampaigns: campaigns.filter((c) => c.status === 'running').length,
    totalSent: 0,
    totalFailed: 0,
    totalReplied: 0,
    totalPending: 0,
    totalContacts: 0,
    overallResponseRate: 0,
    accountStats: {},
  };

  for (const c of campaigns) {
    result.totalSent += c.stats?.sent || 0;
    result.totalFailed += c.stats?.failed || 0;
    result.totalReplied += c.stats?.replied || 0;
    result.totalPending += c.stats?.pending || 0;
    result.totalContacts += c.stats?.total || 0;
  }

  if (result.totalSent > 0) {
    result.overallResponseRate = Math.round((result.totalReplied / result.totalSent) * 10000) / 100;
  }

  for (const [accountId, health] of Object.entries(numberHealth)) {
    result.accountStats[accountId] = { ...health };
  }

  return result;
}

// ---------------------------------------------------------------------------
// Default campaign factory
// ---------------------------------------------------------------------------

function createDefaultCampaign(data) {
  return {
    id: generateId(),
    name: data.name || 'Untitled Campaign',
    status: 'draft',
    message: data.message || '',
    contacts: (data.contacts || []).map((c) => ({
      name: c.name || '',
      phone: c.phone || '',
      company: c.company || '',
      custom1: c.custom1 || '',
      custom2: c.custom2 || '',
      status: 'pending',
      assignedAccount: null,
      sentAt: null,
      repliedAt: null,
    })),
    accountIds: data.accountIds || [],
    settings: {
      dailyLimitPerNumber: 50,
      minDelay: 30,
      maxDelay: 90,
      businessHoursOnly: true,
      businessHoursStart: 9,
      businessHoursEnd: 20,
      warmupEnabled: true,
      warmupDaysToFull: 14,
      warmupStartLimit: 10,
      ...(data.settings || {}),
    },
    stats: { sent: 0, failed: 0, replied: 0, total: (data.contacts || []).length, pending: (data.contacts || []).length },
    createdAt: new Date().toISOString(),
    startedAt: null,
    completedAt: null,
  };
}

// ---------------------------------------------------------------------------
// Init — register all IPC handlers
// ---------------------------------------------------------------------------

function initSmartOutreach({ app, ipcMain, getMainWindow, getViews, getAccounts, getActiveAccountId }) {
  campaignsPath = path.join(app.getPath('userData'), 'outreach-campaigns.json');
  healthPath = path.join(app.getPath('userData'), 'number-health.json');

  loadCampaigns();
  loadHealth();
  performDailyResetIfNeeded();

  log('init', `Loaded ${campaigns.length} campaigns, ${Object.keys(numberHealth).length} health entries`);

  // -- Get all campaigns --------------------------------------------------
  ipcMain.handle('get-outreach-campaigns', () => {
    return campaigns;
  });

  // -- Save (create / update) campaign ------------------------------------
  ipcMain.handle('save-outreach-campaign', (_event, data) => {
    try {
      if (!data.id) {
        // Create new campaign
        const campaign = createDefaultCampaign(data);
        campaigns.push(campaign);
        saveCampaigns();
        broadcastCampaigns(getMainWindow);
        log('save', `Created campaign "${campaign.name}" (${campaign.id})`);
        return { success: true, campaign };
      }

      // Update existing campaign
      const idx = campaigns.findIndex((c) => c.id === data.id);
      if (idx === -1) {
        return { success: false, error: 'Campaign not found' };
      }

      const existing = campaigns[idx];
      if (existing.status === 'running') {
        return { success: false, error: 'Cannot edit a running campaign' };
      }

      // Merge allowed fields
      if (data.name !== undefined) existing.name = data.name;
      if (data.message !== undefined) existing.message = data.message;
      if (data.accountIds !== undefined) existing.accountIds = data.accountIds;
      if (data.settings !== undefined) {
        existing.settings = { ...existing.settings, ...data.settings };
      }
      if (data.contacts !== undefined) {
        existing.contacts = data.contacts.map((c) => ({
          name: c.name || '',
          phone: c.phone || '',
          company: c.company || '',
          custom1: c.custom1 || '',
          custom2: c.custom2 || '',
          status: c.status || 'pending',
          assignedAccount: c.assignedAccount || null,
          sentAt: c.sentAt || null,
          repliedAt: c.repliedAt || null,
        }));
        recalcStats(existing);
      }

      saveCampaigns();
      broadcastCampaigns(getMainWindow);
      log('save', `Updated campaign "${existing.name}" (${existing.id})`);
      return { success: true, campaign: existing };
    } catch (err) {
      logError('save', err.message);
      return { success: false, error: err.message };
    }
  });

  // -- Delete campaign ----------------------------------------------------
  ipcMain.handle('delete-outreach-campaign', (_event, campaignId) => {
    try {
      // Stop if running
      if (activeCampaigns[campaignId]) {
        activeCampaigns[campaignId].stopped = true;
        activeCampaigns[campaignId].paused = true;
      }
      delete activeCampaigns[campaignId];
      stopReplyTracking(campaignId);

      const before = campaigns.length;
      campaigns = campaigns.filter((c) => c.id !== campaignId);

      if (campaigns.length === before) {
        return { success: false, error: 'Campaign not found' };
      }

      saveCampaigns();
      broadcastCampaigns(getMainWindow);
      log('delete', `Deleted campaign ${campaignId}`);
      return { success: true };
    } catch (err) {
      logError('delete', err.message);
      return { success: false, error: err.message };
    }
  });

  // -- Start campaign -----------------------------------------------------
  ipcMain.handle('start-outreach-campaign', (_event, campaignId) => {
    try {
      const campaign = campaigns.find((c) => c.id === campaignId);
      if (!campaign) return { success: false, error: 'Campaign not found' };
      if (campaign.status !== 'draft') return { success: false, error: 'Campaign must be in draft status to start' };
      if (!campaign.accountIds || campaign.accountIds.length === 0) {
        return { success: false, error: 'No accounts assigned to this campaign' };
      }

      campaign.status = 'running';
      campaign.startedAt = new Date().toISOString();
      activeCampaigns[campaignId] = { paused: false, stopped: false };

      // Ensure health entries exist for all assigned accounts
      for (const accId of campaign.accountIds) {
        ensureHealthEntry(accId);
      }
      saveHealth();

      saveCampaigns();
      broadcastCampaigns(getMainWindow);
      sendHealthUpdate(getMainWindow);

      log('start', `Starting campaign "${campaign.name}"`);

      // Run asynchronously — do not await
      runSmartOutreach(campaign, getViews, getMainWindow).catch((err) => {
        logError('start', `Unexpected error in campaign "${campaign.name}":`, err.message);
        campaign.status = 'paused';
        saveCampaigns();
        sendProgress(getMainWindow, campaign);
      });

      return { success: true };
    } catch (err) {
      logError('start', err.message);
      return { success: false, error: err.message };
    }
  });

  // -- Pause campaign -----------------------------------------------------
  ipcMain.handle('pause-outreach-campaign', (_event, campaignId) => {
    try {
      const campaign = campaigns.find((c) => c.id === campaignId);
      if (!campaign) return { success: false, error: 'Campaign not found' };
      if (campaign.status !== 'running') return { success: false, error: 'Campaign is not running' };

      if (activeCampaigns[campaignId]) {
        activeCampaigns[campaignId].paused = true;
      }
      campaign.status = 'paused';
      saveCampaigns();
      broadcastCampaigns(getMainWindow);
      log('pause', `Paused campaign "${campaign.name}"`);
      return { success: true };
    } catch (err) {
      logError('pause', err.message);
      return { success: false, error: err.message };
    }
  });

  // -- Resume campaign ----------------------------------------------------
  ipcMain.handle('resume-outreach-campaign', (_event, campaignId) => {
    try {
      const campaign = campaigns.find((c) => c.id === campaignId);
      if (!campaign) return { success: false, error: 'Campaign not found' };
      if (campaign.status !== 'paused') return { success: false, error: 'Campaign is not paused' };

      campaign.status = 'running';
      activeCampaigns[campaignId] = { paused: false, stopped: false };

      saveCampaigns();
      broadcastCampaigns(getMainWindow);
      log('resume', `Resumed campaign "${campaign.name}"`);

      runSmartOutreach(campaign, getViews, getMainWindow).catch((err) => {
        logError('resume', `Unexpected error in campaign "${campaign.name}":`, err.message);
        campaign.status = 'paused';
        saveCampaigns();
        sendProgress(getMainWindow, campaign);
      });

      return { success: true };
    } catch (err) {
      logError('resume', err.message);
      return { success: false, error: err.message };
    }
  });

  // -- Get number health --------------------------------------------------
  ipcMain.handle('get-number-health', () => {
    return numberHealth;
  });

  // -- Reset number health for a specific account -------------------------
  ipcMain.handle('reset-number-health', (_event, accountId) => {
    try {
      if (!accountId) return { success: false, error: 'Account ID required' };
      numberHealth[accountId] = {
        accountId,
        healthScore: 100,
        sentToday: 0,
        sentThisWeek: 0,
        totalSent: 0,
        totalReplies: 0,
        responseRate: 0,
        lastSentAt: null,
        firstUsedAt: null,
        warnings: 0,
        paused: false,
        pausedReason: null,
        dailyHistory: [],
      };
      saveHealth();
      sendHealthUpdate(getMainWindow);
      log('resetHealth', `Reset health for account ${accountId}`);
      return { success: true };
    } catch (err) {
      logError('resetHealth', err.message);
      return { success: false, error: err.message };
    }
  });

  // -- Mark contact replied -----------------------------------------------
  ipcMain.handle('mark-contact-replied', (_event, { campaignId, phone }) => {
    try {
      const campaign = campaigns.find((c) => c.id === campaignId);
      if (!campaign) return { success: false, error: 'Campaign not found' };

      const contact = campaign.contacts.find((c) => c.phone === phone && c.status === 'sent');
      if (!contact) return { success: false, error: 'Sent contact not found with that phone' };

      contact.status = 'replied';
      contact.repliedAt = new Date().toISOString();
      recalcStats(campaign);

      // Update number health
      if (contact.assignedAccount) {
        const health = ensureHealthEntry(contact.assignedAccount);
        health.totalReplies++;
        updateResponseRate(health);
        health.healthScore = calculateHealthScore(health, campaign.settings.dailyLimitPerNumber);
        saveHealth();
        sendHealthUpdate(getMainWindow);
      }

      saveCampaigns();
      sendProgress(getMainWindow, campaign);
      log('markReplied', `Marked ${phone} as replied in campaign ${campaignId}`);
      return { success: true };
    } catch (err) {
      logError('markReplied', err.message);
      return { success: false, error: err.message };
    }
  });

  // -- Get aggregated stats -----------------------------------------------
  ipcMain.handle('get-outreach-stats', () => {
    return getAggregatedStats();
  });

  // -- Cleanup on app quit ------------------------------------------------
  app.on('before-quit', () => {
    log('cleanup', 'App quitting — pausing active campaigns');
    for (const campaignId of Object.keys(activeCampaigns)) {
      activeCampaigns[campaignId].paused = true;
      activeCampaigns[campaignId].stopped = true;
      const c = campaigns.find((x) => x.id === campaignId);
      if (c && c.status === 'running') {
        c.status = 'paused';
      }
    }
    // Stop all reply trackers
    for (const campaignId of Object.keys(replyCheckTimers)) {
      stopReplyTracking(campaignId);
    }
    saveCampaigns();
    saveHealth();
  });
}

module.exports = { initSmartOutreach };
