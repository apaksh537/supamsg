const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

function initAutoTranslate({ app, ipcMain, getMainWindow, getViews, getActiveAccountId, getAccounts }) {
  const userDataPath = app.getPath('userData');
  const translateConfigPath = path.join(userDataPath, 'translate-config.json');
  const translateCachePath = path.join(userDataPath, 'translate-cache.json');

  const CACHE_TTL = 24 * 60 * 60 * 1000; // 24 hours

  const SUPPORTED_LANGUAGES = [
    'English', 'Hindi', 'Spanish', 'French', 'Arabic', 'Portuguese',
    'German', 'Japanese', 'Chinese', 'Korean', 'Russian', 'Italian',
    'Dutch', 'Turkish', 'Thai', 'Vietnamese', 'Indonesian', 'Bengali',
    'Tamil', 'Telugu', 'Urdu', 'Marathi', 'Gujarati', 'Kannada', 'Malayalam',
  ];

  // --- Helpers ---

  function readJSON(filePath, fallback = {}) {
    try {
      if (fs.existsSync(filePath)) {
        return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
      }
    } catch (e) {
      console.error(`[auto-translate] Failed to read ${filePath}:`, e.message);
    }
    return fallback;
  }

  function writeJSON(filePath, data) {
    try {
      fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
    } catch (e) {
      console.error(`[auto-translate] Failed to write ${filePath}:`, e.message);
    }
  }

  function getConfig() {
    return readJSON(translateConfigPath, {
      enabled: false,
      myLanguage: 'English',
      contactLanguages: {},
      translationHistory: {},
    });
  }

  function saveConfig(config) {
    writeJSON(translateConfigPath, config);
  }

  function getCache() {
    return readJSON(translateCachePath, {});
  }

  function saveCache(cache) {
    writeJSON(translateCachePath, cache);
  }

  function getCacheKey(text, fromLanguage, toLanguage) {
    const hash = crypto.createHash('md5').update(`${text}|${fromLanguage}|${toLanguage}`).digest('hex');
    return hash;
  }

  function getApiKey() {
    const settingsPath = path.join(userDataPath, 'settings.json');
    const settings = readJSON(settingsPath, {});
    return settings.anthropicApiKey || null;
  }

  async function translateWithClaude(text, fromLanguage, toLanguage) {
    const apiKey = getApiKey();
    if (!apiKey) {
      throw new Error('Anthropic API key not configured. Set it in Settings.');
    }

    // Check cache first
    const cacheKey = getCacheKey(text, fromLanguage, toLanguage);
    const cache = getCache();
    if (cache[cacheKey] && (Date.now() - cache[cacheKey].cachedAt) < CACHE_TTL) {
      return cache[cacheKey].translation;
    }

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 1024,
        messages: [
          {
            role: 'user',
            content: `Translate this text from ${fromLanguage} to ${toLanguage}. Return only the translation, nothing else: ${text}`,
          },
        ],
      }),
    });

    if (!response.ok) {
      const errorBody = await response.text();
      throw new Error(`Translation API error: ${response.status} — ${errorBody}`);
    }

    const result = await response.json();
    const translation = result.content?.[0]?.text || '';

    // Cache the result
    cache[cacheKey] = {
      translation,
      cachedAt: Date.now(),
      fromLanguage,
      toLanguage,
    };

    // Prune expired cache entries
    const now = Date.now();
    for (const key of Object.keys(cache)) {
      if (now - cache[key].cachedAt > CACHE_TTL) {
        delete cache[key];
      }
    }
    saveCache(cache);

    return translation;
  }

  // --- IPC Handlers ---

  ipcMain.handle('get-translate-config', async () => {
    const config = getConfig();
    return {
      enabled: config.enabled,
      myLanguage: config.myLanguage,
      contactLanguages: config.contactLanguages || {},
    };
  });

  ipcMain.on('set-contact-language', (event, { contactKey, language }) => {
    const config = getConfig();
    if (!config.contactLanguages) config.contactLanguages = {};
    config.contactLanguages[contactKey] = language;
    saveConfig(config);

    const win = getMainWindow();
    if (win) win.webContents.send('translate-config-updated', { contactKey, language });
  });

  ipcMain.on('remove-contact-language', (event, { contactKey }) => {
    const config = getConfig();
    if (config.contactLanguages) {
      delete config.contactLanguages[contactKey];
      saveConfig(config);
    }

    const win = getMainWindow();
    if (win) win.webContents.send('translate-config-updated', { contactKey, language: null });
  });

  ipcMain.handle('get-supported-languages', async () => {
    return SUPPORTED_LANGUAGES;
  });

  ipcMain.handle('translate-text', async (event, { text, fromLanguage, toLanguage }) => {
    if (!text || !fromLanguage || !toLanguage) {
      return { error: 'Missing required parameters: text, fromLanguage, toLanguage' };
    }
    if (fromLanguage === toLanguage) {
      return { translation: text };
    }
    try {
      const translation = await translateWithClaude(text, fromLanguage, toLanguage);
      return { translation };
    } catch (e) {
      console.error('[auto-translate] Translation failed:', e.message);
      return { error: e.message };
    }
  });

  ipcMain.handle('auto-translate-incoming', async (event, { text, contactKey }) => {
    const config = getConfig();
    if (!config.enabled) {
      return { translated: false, text };
    }

    const contactLanguage = config.contactLanguages?.[contactKey];
    if (!contactLanguage || contactLanguage === config.myLanguage) {
      return { translated: false, text };
    }

    try {
      const translation = await translateWithClaude(text, contactLanguage, config.myLanguage);

      // Save to translation history
      if (!config.translationHistory) config.translationHistory = {};
      if (!config.translationHistory[contactKey]) config.translationHistory[contactKey] = [];
      config.translationHistory[contactKey].push({
        original: text,
        translated: translation,
        from: contactLanguage,
        to: config.myLanguage,
        timestamp: new Date().toISOString(),
      });
      // Keep only last 100 translations per contact
      if (config.translationHistory[contactKey].length > 100) {
        config.translationHistory[contactKey] = config.translationHistory[contactKey].slice(-100);
      }
      saveConfig(config);

      return { translated: true, text: translation, originalText: text };
    } catch (e) {
      console.error('[auto-translate] Auto-translate failed:', e.message);
      return { translated: false, text, error: e.message };
    }
  });

  ipcMain.on('set-auto-translate', (event, { enabled, myLanguage }) => {
    const config = getConfig();
    config.enabled = enabled;
    if (myLanguage) config.myLanguage = myLanguage;
    saveConfig(config);

    const win = getMainWindow();
    if (win) win.webContents.send('auto-translate-toggled', { enabled, myLanguage: config.myLanguage });
  });

  ipcMain.handle('get-translation-history', async (event, { contactKey }) => {
    const config = getConfig();
    return (config.translationHistory && config.translationHistory[contactKey]) || [];
  });
}

module.exports = { initAutoTranslate };
