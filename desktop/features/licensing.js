// Licensing & Feature Gating
// Uses Razorpay for payments, subscription verification via SupaMsg API
// Works offline — caches subscription locally, validates with API periodically

const path = require('path');
const fs = require('fs');
const https = require('https');

const API_BASE = 'api.supamsg.com';

let licensePath;
let settingsPath;
let license = {
  tier: 'free',
  email: null,
  subscriptionId: null,
  validUntil: null,
  lastVerified: null,
};

// Feature gates per tier
const TIER_FEATURES = {
  free: {
    maxAccounts: 3,
    templates: true,
    scheduling: false,
    aiReplies: false,
    automations: false,
    broadcast: false,
    chatExport: false,
    contactLabels: true,
    analytics: false,
    stealthMode: false,
    splitScreen: false,
    crmIntegration: false,
    smartOutreach: false,
    aiDailyLimit: 0,
  },
  starter: {
    maxAccounts: Infinity,
    templates: true,
    scheduling: true,
    aiReplies: true,
    automations: false,
    broadcast: false,
    chatExport: false,
    contactLabels: true,
    analytics: false,
    stealthMode: true,
    splitScreen: true,
    crmIntegration: false,
    smartOutreach: false,
    aiDailyLimit: 10,
    schedulingDailyLimit: 10,
  },
  pro: {
    maxAccounts: Infinity,
    templates: true,
    scheduling: true,
    aiReplies: true,
    automations: false,
    broadcast: false,
    chatExport: true,
    contactLabels: true,
    analytics: true,
    stealthMode: true,
    splitScreen: true,
    crmIntegration: false,
    smartOutreach: false,
    aiDailyLimit: 50,
  },
  business: {
    maxAccounts: Infinity,
    templates: true,
    scheduling: true,
    aiReplies: true,
    automations: true,
    broadcast: true,
    chatExport: true,
    contactLabels: true,
    analytics: true,
    stealthMode: true,
    splitScreen: true,
    crmIntegration: true,
    smartOutreach: true,
    aiDailyLimit: Infinity,
  },
};

// Pricing config (INR base, USD for international display)
const PRICING = {
  starter: { inr: 199, usd: 3, inrAnnual: 1499, usdAnnual: 29 },
  pro: { inr: 499, usd: 6, inrAnnual: 3999, usdAnnual: 48 },
  business: { inr: 999, usd: 12, inrAnnual: 7999, usdAnnual: 96 },
};

function initLicensing({ app, ipcMain, getMainWindow }) {
  licensePath = path.join(app.getPath('userData'), 'license.json');
  settingsPath = path.join(app.getPath('userData'), 'settings.json');
  loadLicense();

  // Get current license info
  ipcMain.handle('get-license', () => ({
    tier: license.tier,
    email: license.email,
    validUntil: license.validUntil,
    features: TIER_FEATURES[license.tier] || TIER_FEATURES.free,
  }));

  // Check single feature
  ipcMain.handle('check-feature', (_event, featureName) => {
    const features = TIER_FEATURES[license.tier] || TIER_FEATURES.free;
    return features[featureName] ?? false;
  });

  // Get all tiers
  ipcMain.handle('get-tiers', () => TIER_FEATURES);

  // Get pricing
  ipcMain.handle('get-pricing', () => PRICING);

  // Create Razorpay subscription via backend
  ipcMain.handle('create-subscription', async (_event, { email, tier, annual }) => {
    try {
      const result = await apiPost('/create-subscription', { email, tier, annual });
      return result;
    } catch (e) {
      return { error: e.message };
    }
  });

  // Verify payment after Razorpay checkout
  ipcMain.handle('verify-payment', async (_event, { razorpay_payment_id, razorpay_subscription_id, razorpay_signature, email, tier }) => {
    try {
      const result = await apiPost('/verify-payment', {
        razorpay_payment_id,
        razorpay_subscription_id,
        razorpay_signature,
        email,
        tier,
      });

      if (result.valid) {
        license = {
          tier: result.tier || tier,
          email,
          subscriptionId: razorpay_subscription_id,
          validUntil: new Date(Date.now() + 365 * 86400000).toISOString(),
          lastVerified: new Date().toISOString(),
        };
        saveLicense();
        broadcast(getMainWindow());
        return { success: true, tier: license.tier };
      }

      return { success: false, error: result.error || 'Payment verification failed' };
    } catch (e) {
      return { success: false, error: e.message };
    }
  });

  // Activate via email (for users who already paid)
  ipcMain.handle('activate-license', async (_event, { email }) => {
    try {
      const result = await apiPost('/verify', { email });

      if (result.active) {
        license = {
          tier: result.tier,
          email,
          subscriptionId: result.subscription_id || license.subscriptionId,
          validUntil: result.current_end || new Date(Date.now() + 365 * 86400000).toISOString(),
          lastVerified: new Date().toISOString(),
        };
        saveLicense();
        broadcast(getMainWindow());
        return { success: true, tier: license.tier };
      }

      return { success: false, error: 'No active subscription found for this email' };
    } catch (e) {
      return { success: false, error: e.message };
    }
  });

  // Validate existing subscription (periodic check)
  ipcMain.handle('validate-license', async () => {
    if (!license.email) return { valid: false };

    try {
      const result = await apiPost('/verify', { email: license.email });

      if (result.active) {
        license.tier = result.tier;
        license.lastVerified = new Date().toISOString();
        if (result.current_end) license.validUntil = result.current_end;
        saveLicense();
        return { valid: true, tier: license.tier };
      }

      // Subscription no longer active
      license.tier = 'free';
      saveLicense();
      broadcast(getMainWindow());
      return { valid: false, reason: 'Subscription expired or cancelled' };
    } catch (e) {
      // Offline — check grace period (7 days)
      if (license.lastVerified) {
        const lastCheck = new Date(license.lastVerified);
        const graceDays = 7;
        if (Date.now() - lastCheck.getTime() < graceDays * 86400000) {
          return { valid: true, offline: true, tier: license.tier };
        }
      }
      return { valid: false, error: 'Unable to verify subscription' };
    }
  });

  // Deactivate / sign out
  ipcMain.handle('deactivate-license', async () => {
    license = { tier: 'free', email: null, subscriptionId: null, validUntil: null, lastVerified: null };
    saveLicense();
    broadcast(getMainWindow());
    return { success: true };
  });

  // Get Razorpay key (public key only — safe for client).
  // This is intentionally the Razorpay PUBLIC key (not the secret key).
  // Public keys are designed to be embedded in client-side code per Razorpay docs.
  // The secret key is only used server-side for signature verification.
  ipcMain.handle('get-razorpay-key', () => {
    return 'rzp_live_SUiVuogZWjVUKd';
  });

  // Periodic validation (every 24 hours)
  setInterval(async () => {
    if (license.tier !== 'free' && license.email) {
      try {
        const result = await apiPost('/verify', { email: license.email });
        if (result.active) {
          license.lastVerified = new Date().toISOString();
          saveLicense();
        } else {
          const lastCheck = new Date(license.lastVerified || 0);
          if (Date.now() - lastCheck.getTime() > 7 * 86400000) {
            license.tier = 'free';
            saveLicense();
            broadcast(getMainWindow());
          }
        }
      } catch (e) {
        // Offline, grace period handled above
      }
    }
  }, 86400000);
}

// ── API helper ────────────────────────────────────────────────

function apiPost(endpoint, data) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(data);

    const req = https.request({
      hostname: API_BASE,
      path: endpoint,
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
    }, (res) => {
      let responseData = '';
      res.on('data', (chunk) => responseData += chunk);
      res.on('end', () => {
        try {
          resolve(JSON.parse(responseData));
        } catch (e) {
          reject(new Error('Invalid response from server'));
        }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

// ── Persistence ──────────────────────────────────────────────

function loadLicense() {
  try {
    if (fs.existsSync(licensePath)) {
      license = { ...license, ...JSON.parse(fs.readFileSync(licensePath, 'utf8')) };
    }
  } catch (e) {}
}

function saveLicense() {
  fs.writeFileSync(licensePath, JSON.stringify(license, null, 2));
}

function broadcast(mainWindow) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('license-updated', {
      tier: license.tier,
      email: license.email,
      validUntil: license.validUntil,
      features: TIER_FEATURES[license.tier] || TIER_FEATURES.free,
    });
  }
}

module.exports = { initLicensing, TIER_FEATURES };
