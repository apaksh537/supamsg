// Licensing & Feature Gating
// Uses Lemon Squeezy for payments, license key validation, and subscription management
// Works offline — caches license locally, validates with Lemon Squeezy API periodically

const path = require('path');
const fs = require('fs');
const https = require('https');

let licensePath;
let settingsPath;
let license = {
  tier: 'free',
  email: null,
  licenseKey: null,
  instanceId: null,
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
    crmIntegration: false,
    splitScreen: false,
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
    aiDailyLimit: Infinity,
  },
};

// Lemon Squeezy API base
const LS_API = 'api.lemonsqueezy.com';

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

  // Activate license key via Lemon Squeezy API
  ipcMain.handle('activate-license', async (_event, { licenseKey, email }) => {
    try {
      const result = await lsActivateLicense(licenseKey);

      if (result.error) {
        return { success: false, error: result.error };
      }

      // Determine tier from Lemon Squeezy product/variant name
      const tier = determineTier(result.meta);

      license = {
        tier,
        email: email || result.meta?.customer_email || null,
        licenseKey,
        instanceId: result.instance?.id || null,
        validUntil: result.meta?.valid_until || new Date(Date.now() + 365 * 86400000).toISOString(),
        lastVerified: new Date().toISOString(),
      };
      saveLicense();
      broadcast(getMainWindow());

      return { success: true, tier };
    } catch (e) {
      return { success: false, error: e.message };
    }
  });

  // Validate existing license (periodic check)
  ipcMain.handle('validate-license', async () => {
    if (!license.licenseKey) return { valid: false };

    try {
      const result = await lsValidateLicense(license.licenseKey, license.instanceId);

      if (result.valid) {
        license.lastVerified = new Date().toISOString();
        if (result.meta?.valid_until) license.validUntil = result.meta.valid_until;
        saveLicense();
        return { valid: true, tier: license.tier };
      }

      // License no longer valid
      license.tier = 'free';
      saveLicense();
      broadcast(getMainWindow());
      return { valid: false, reason: result.error || 'License expired' };
    } catch (e) {
      // Offline — check grace period (7 days)
      if (license.lastVerified) {
        const lastCheck = new Date(license.lastVerified);
        const graceDays = 7;
        if (Date.now() - lastCheck.getTime() < graceDays * 86400000) {
          return { valid: true, offline: true, tier: license.tier };
        }
      }
      return { valid: false, error: 'Unable to verify license' };
    }
  });

  // Deactivate license
  ipcMain.handle('deactivate-license', async () => {
    if (license.licenseKey && license.instanceId) {
      try {
        await lsDeactivateLicense(license.licenseKey, license.instanceId);
      } catch (e) {
        // Ignore deactivation errors
      }
    }

    license = { tier: 'free', email: null, licenseKey: null, instanceId: null, validUntil: null, lastVerified: null };
    saveLicense();
    broadcast(getMainWindow());
    return { success: true };
  });

  // Get checkout URL (opens Lemon Squeezy checkout in browser)
  ipcMain.handle('get-checkout-url', (_event, { tier, annual }) => {
    const urls = {
      pro: 'https://supamsg.lemonsqueezy.com/checkout/buy/1943d03e-6e5d-4a2e-8534-e383682a05c3',
      'pro-annual': 'https://supamsg.lemonsqueezy.com/checkout/buy/6e67b7fa-b653-48f8-8c66-0d6578794982',
      business: 'https://supamsg.lemonsqueezy.com/checkout/buy/bba824cf-56c1-42d7-8286-2a4c2f1206e0',
      'business-annual': 'https://supamsg.lemonsqueezy.com/checkout/buy/60eac4c2-78f5-4b40-9bfe-47f2847bc335',
    };
    const key = annual ? `${tier}-annual` : tier;
    return urls[key] || null;
  });

  // Open customer portal
  ipcMain.handle('get-customer-portal-url', () => {
    const settings = loadAppSettings();
    return settings.lsCustomerPortalUrl || 'https://supamsg.lemonsqueezy.com/billing';
  });

  // Periodic validation (every 24 hours)
  setInterval(async () => {
    if (license.tier !== 'free' && license.licenseKey) {
      try {
        const result = await lsValidateLicense(license.licenseKey, license.instanceId);
        if (result.valid) {
          license.lastVerified = new Date().toISOString();
          saveLicense();
        } else {
          // Check grace period
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

// ── Lemon Squeezy API calls ─────────────────────────────────

function lsActivateLicense(licenseKey) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({ license_key: licenseKey, instance_name: `supamsg-${require('os').hostname()}` });

    const req = https.request({
      hostname: LS_API,
      path: '/v1/licenses/activate',
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
    }, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          if (parsed.activated || parsed.valid) {
            resolve({ meta: parsed.meta || parsed.license_key, instance: parsed.instance });
          } else {
            resolve({ error: parsed.error || parsed.message || 'Activation failed' });
          }
        } catch (e) {
          reject(new Error('Invalid response from license server'));
        }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

function lsValidateLicense(licenseKey, instanceId) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({ license_key: licenseKey, instance_id: instanceId });

    const req = https.request({
      hostname: LS_API,
      path: '/v1/licenses/validate',
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
    }, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          resolve({ valid: parsed.valid === true, meta: parsed.meta || parsed.license_key, error: parsed.error });
        } catch (e) {
          reject(new Error('Invalid response'));
        }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

function lsDeactivateLicense(licenseKey, instanceId) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({ license_key: licenseKey, instance_id: instanceId });

    const req = https.request({
      hostname: LS_API,
      path: '/v1/licenses/deactivate',
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
    }, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => resolve(JSON.parse(data)));
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

// ── Tier detection from Lemon Squeezy product metadata ───────

function determineTier(meta) {
  if (!meta) return 'pro';

  const name = (meta.variant_name || meta.product_name || '').toLowerCase();
  if (name.includes('business') || name.includes('team')) return 'business';
  if (name.includes('pro')) return 'pro';

  // Fallback: check by product ID from settings
  const settings = loadAppSettings();
  const productId = String(meta.product_id || '');
  if (productId === settings.lsBusinessProductId) return 'business';

  return 'pro';
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

function loadAppSettings() {
  try {
    if (fs.existsSync(settingsPath)) {
      return JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
    }
  } catch (e) {}
  return {};
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
