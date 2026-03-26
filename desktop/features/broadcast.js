// Broadcast / Campaign messaging: send a personalized message to a list of contacts
// Stores campaigns in local JSON, sends sequentially with delay to avoid rate limiting

const path = require('path');
const fs = require('fs');

const MIN_DELAY = 45; // minimum seconds between messages (safety floor — protects against WhatsApp bans)
const MAX_DELAY = 120; // maximum seconds for random delay
const MAX_CONTACTS = 50; // free tier limit per campaign
const MAX_PER_DAY = 50; // maximum messages per day per account (WhatsApp safe threshold)

let campaignsPath;
let campaigns = [];
let activeSends = {}; // campaignId -> { paused: bool, abortController: null }

function initBroadcast({ app, ipcMain, getMainWindow, getViews }) {
  campaignsPath = path.join(app.getPath('userData'), 'campaigns.json');
  loadCampaigns();

  ipcMain.handle('get-campaigns', () => {
    return campaigns;
  });

  ipcMain.on('save-campaign', (_event, campaign) => {
    if (!campaign.id) {
      campaign.id = `campaign-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
      campaign.status = 'draft';
      campaign.createdAt = new Date().toISOString();
      campaign.startedAt = null;
      campaign.completedAt = null;
      campaign.stats = { sent: 0, failed: 0, total: campaign.contacts.length };

      // Enforce max contacts
      if (campaign.contacts.length > MAX_CONTACTS) {
        campaign.contacts = campaign.contacts.slice(0, MAX_CONTACTS);
        campaign.stats.total = MAX_CONTACTS;
      }

      // Ensure every contact has a pending status
      campaign.contacts = campaign.contacts.map((c) => ({
        ...c,
        status: 'pending',
      }));

      campaigns.push(campaign);
    } else {
      const idx = campaigns.findIndex((c) => c.id === campaign.id);
      if (idx !== -1) {
        // Only allow edits while draft
        if (campaigns[idx].status === 'draft') {
          if (campaign.contacts && campaign.contacts.length > MAX_CONTACTS) {
            campaign.contacts = campaign.contacts.slice(0, MAX_CONTACTS);
          }
          if (campaign.contacts) {
            campaign.contacts = campaign.contacts.map((c) => ({
              ...c,
              status: c.status || 'pending',
            }));
            campaign.stats = {
              sent: 0,
              failed: 0,
              total: campaign.contacts.length,
            };
          }
          Object.assign(campaigns[idx], campaign);
        }
      }
    }
    saveCampaigns();
    broadcastCampaigns(getMainWindow());
  });

  ipcMain.on('delete-campaign', (_event, campaignId) => {
    // Stop if running
    if (activeSends[campaignId]) {
      activeSends[campaignId].paused = true;
    }
    delete activeSends[campaignId];
    campaigns = campaigns.filter((c) => c.id !== campaignId);
    saveCampaigns();
    broadcastCampaigns(getMainWindow());
  });

  ipcMain.on('start-campaign', (_event, campaignId) => {
    const campaign = campaigns.find((c) => c.id === campaignId);
    if (!campaign) return;
    if (campaign.status !== 'draft') return;

    campaign.status = 'running';
    campaign.startedAt = new Date().toISOString();
    activeSends[campaignId] = { paused: false };
    saveCampaigns();
    broadcastCampaigns(getMainWindow());

    runCampaign(campaign, getViews, getMainWindow);
  });

  ipcMain.on('pause-campaign', (_event, campaignId) => {
    if (activeSends[campaignId]) {
      activeSends[campaignId].paused = true;
    }
    const campaign = campaigns.find((c) => c.id === campaignId);
    if (campaign && campaign.status === 'running') {
      campaign.status = 'paused';
      saveCampaigns();
      broadcastCampaigns(getMainWindow());
    }
  });

  ipcMain.on('resume-campaign', (_event, campaignId) => {
    const campaign = campaigns.find((c) => c.id === campaignId);
    if (!campaign) return;
    if (campaign.status !== 'paused') return;

    campaign.status = 'running';
    activeSends[campaignId] = { paused: false };
    saveCampaigns();
    broadcastCampaigns(getMainWindow());

    runCampaign(campaign, getViews, getMainWindow);
  });
}

async function runCampaign(campaign, getViews, getMainWindow) {
  // Use random delay between MIN_DELAY and MAX_DELAY for human-like behavior
  function getRandomDelay() {
    const base = MIN_DELAY + Math.random() * (MAX_DELAY - MIN_DELAY);
    // 10% chance of a longer "break" (2-5 minutes) to mimic human pauses
    if (Math.random() < 0.1) return base + 120 + Math.random() * 180;
    return base;
  }
  const delay = Math.max(MIN_DELAY, campaign.delayBetween || MIN_DELAY);

  let sentThisSession = 0;

  for (const contact of campaign.contacts) {
    if (contact.status !== 'pending') continue;

    // Enforce daily limit to protect against WhatsApp bans
    if (sentThisSession >= MAX_PER_DAY) {
      campaign.status = 'paused';
      saveCampaigns();
      sendProgress(getMainWindow, campaign);
      return; // pause until tomorrow
    }

    // Check if paused or deleted
    if (!activeSends[campaign.id] || activeSends[campaign.id].paused) {
      return; // exit the loop, campaign will stay paused
    }

    const views = getViews();
    const view = views[campaign.accountId];
    if (!view) {
      contact.status = 'failed';
      campaign.stats.failed++;
      saveCampaigns();
      sendProgress(getMainWindow(), campaign);
      continue;
    }

    const personalizedMessage = campaign.message.replace(/\{name\}/g, contact.name);

    try {
      const result = await view.webContents.executeJavaScript(`
        (async () => {
          const searchQuery = ${JSON.stringify(contact.name)};
          const message = ${JSON.stringify(personalizedMessage)};

          // Click the search/new chat button
          const searchBox = document.querySelector('[data-testid="chat-list-search"]') ||
                            document.querySelector('[contenteditable="true"][data-tab="3"]');
          if (!searchBox) return { success: false, error: 'Search box not found' };

          // Focus and type into search
          searchBox.focus();
          searchBox.textContent = '';
          document.execCommand('insertText', false, searchQuery);

          // Wait for search results
          await new Promise(r => setTimeout(r, 2000));

          // Click first matching result
          const results = document.querySelectorAll('[data-testid="cell-frame-container"]');
          if (results.length === 0) return { success: false, error: 'Contact not found: ' + searchQuery };
          results[0].click();

          // Wait for chat to open
          await new Promise(r => setTimeout(r, 1000));

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
          msgInput.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true }));
          return { success: true, method: 'enter-key' };
        })();
      `);

      if (result?.success) {
        contact.status = 'sent';
        campaign.stats.sent++;
        sentThisSession++;
      } else {
        contact.status = 'failed';
        campaign.stats.failed++;
      }
    } catch (err) {
      contact.status = 'failed';
      campaign.stats.failed++;
    }

    saveCampaigns();
    sendProgress(getMainWindow(), campaign);

    // Wait before next contact with random human-like delay
    if (campaign.contacts.some((c) => c.status === 'pending')) {
      const randomDelay = getRandomDelay();
      await sleep(randomDelay * 1000);
    }

    // Re-check pause after delay
    if (!activeSends[campaign.id] || activeSends[campaign.id].paused) {
      return;
    }
  }

  // All contacts processed
  campaign.status = 'completed';
  campaign.completedAt = new Date().toISOString();
  delete activeSends[campaign.id];
  saveCampaigns();
  sendProgress(getMainWindow(), campaign);
}

function sendProgress(mainWindow, campaign) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('campaign-progress', campaign);
  }
}

function broadcastCampaigns(mainWindow) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('campaigns-updated', campaigns);
  }
}

function loadCampaigns() {
  try {
    if (fs.existsSync(campaignsPath)) {
      campaigns = JSON.parse(fs.readFileSync(campaignsPath, 'utf8'));
      // Reset any campaigns that were mid-run when the app closed
      for (const c of campaigns) {
        if (c.status === 'running') {
          c.status = 'paused';
        }
      }
    }
  } catch (e) {
    campaigns = [];
  }
}

function saveCampaigns() {
  fs.writeFileSync(campaignsPath, JSON.stringify(campaigns, null, 2));
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

module.exports = { initBroadcast };
