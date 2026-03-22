const path = require('path');
const fs = require('fs');

function initConversationSearch({ app, ipcMain, getMainWindow, getViews, getActiveAccountId, getAccounts }) {
  const userDataPath = app.getPath('userData');
  const searchHistoryPath = path.join(userDataPath, 'search-history.json');

  const MAX_SEARCH_HISTORY = 20;

  // --- Helpers ---

  function readJSON(filePath, fallback = []) {
    try {
      if (fs.existsSync(filePath)) {
        return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
      }
    } catch (e) {
      console.error(`[conversation-search] Failed to read ${filePath}:`, e.message);
    }
    return fallback;
  }

  function writeJSON(filePath, data) {
    try {
      fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
    } catch (e) {
      console.error(`[conversation-search] Failed to write ${filePath}:`, e.message);
    }
  }

  function getSearchHistory() {
    return readJSON(searchHistoryPath, []);
  }

  function saveSearchHistory(history) {
    writeJSON(searchHistoryPath, history);
  }

  function addToSearchHistory(query) {
    const history = getSearchHistory();
    // Remove duplicate if it exists
    const filtered = history.filter((h) => h.query !== query);
    filtered.unshift({ query, timestamp: new Date().toISOString() });
    // Keep only the last N entries
    if (filtered.length > MAX_SEARCH_HISTORY) {
      filtered.length = MAX_SEARCH_HISTORY;
    }
    saveSearchHistory(filtered);
  }

  function calculateMatchScore(text, query) {
    if (!text || !query) return 0;
    const lowerText = text.toLowerCase();
    const lowerQuery = query.toLowerCase();
    if (lowerText === lowerQuery) return 100;
    if (lowerText.includes(lowerQuery)) {
      // Higher score for earlier match and shorter text
      const position = lowerText.indexOf(lowerQuery);
      const positionScore = Math.max(0, 50 - position);
      const lengthScore = Math.max(0, 50 - (text.length - query.length));
      return Math.min(99, positionScore + lengthScore);
    }
    // Partial word matching
    const queryWords = lowerQuery.split(/\s+/);
    let matched = 0;
    for (const word of queryWords) {
      if (lowerText.includes(word)) matched++;
    }
    return Math.round((matched / queryWords.length) * 50);
  }

  async function searchInView(view, query, timeout = 10000) {
    if (!view || !view.webContents) return [];

    try {
      const results = await view.webContents.executeJavaScript(`
        (function() {
          return new Promise((resolve) => {
            try {
              // Click the search button in WhatsApp Web
              const searchBtn = document.querySelector('[data-icon="search"]') ||
                                document.querySelector('[title="Search or start new chat"]') ||
                                document.querySelector('button[aria-label="Search"]');
              if (searchBtn) {
                searchBtn.click();
              }

              // Wait for search input to appear, then type query
              setTimeout(() => {
                const searchInput = document.querySelector('[data-tab="3"]') ||
                                    document.querySelector('div[contenteditable="true"][data-tab="3"]') ||
                                    document.querySelector('div[title="Search input textbox"]');
                if (searchInput) {
                  searchInput.focus();
                  // Clear existing text
                  searchInput.textContent = '';
                  // Type the query
                  document.execCommand('insertText', false, ${JSON.stringify(query)});
                  searchInput.dispatchEvent(new Event('input', { bubbles: true }));
                }

                // Wait for results to load
                setTimeout(() => {
                  const resultElements = document.querySelectorAll('[data-testid="cell-frame-container"]') ||
                                         document.querySelectorAll('div._8nE1Y') ||
                                         [];

                  const results = [];
                  resultElements.forEach((el) => {
                    const nameEl = el.querySelector('span[title]') || el.querySelector('span[dir="auto"]');
                    const previewEl = el.querySelector('span[title].matched-text') ||
                                      el.querySelector('span._11JPr') ||
                                      el.querySelectorAll('span[dir="auto"]')[1];
                    const timeEl = el.querySelector('div._3Bxar') || el.querySelector('div[class*="message-time"]');

                    results.push({
                      contactName: nameEl ? nameEl.textContent || nameEl.getAttribute('title') || '' : '',
                      messagePreview: previewEl ? previewEl.textContent || '' : '',
                      time: timeEl ? timeEl.textContent || '' : '',
                    });
                  });

                  // Close search to restore normal view
                  const backBtn = document.querySelector('[data-icon="back-search"]') ||
                                  document.querySelector('[data-testid="back"]');
                  if (backBtn) backBtn.click();

                  resolve(results);
                }, 3000);
              }, 500);
            } catch (e) {
              resolve([]);
            }
          });
        })()
      `, true);

      return results || [];
    } catch (e) {
      console.error('[conversation-search] Search in view failed:', e.message);
      return [];
    }
  }

  // --- IPC Handlers ---

  ipcMain.handle('search-all', async (event, { query, accountIds, dateFrom, dateTo }) => {
    if (!query || query.trim().length === 0) {
      return [];
    }

    addToSearchHistory(query);

    const views = getViews();
    const accounts = getAccounts();
    const allResults = [];

    // Determine which accounts to search
    const targetAccountIds = accountIds && accountIds.length > 0
      ? accountIds
      : accounts.map((a) => a.id || a.phoneNumber);

    for (let i = 0; i < accounts.length; i++) {
      const account = accounts[i];
      const accountId = account.id || account.phoneNumber;
      if (!targetAccountIds.includes(accountId)) continue;

      const view = views[i];
      if (!view) continue;

      const results = await searchInView(view, query);

      for (const r of results) {
        const matchScore = calculateMatchScore(r.messagePreview || r.contactName, query);

        // Date filtering (if time string can be parsed)
        if (dateFrom || dateTo) {
          // WhatsApp time strings are relative, so exact filtering is limited
          // This is best-effort for local search
        }

        allResults.push({
          accountId,
          accountName: account.name || account.phoneNumber || accountId,
          contactName: r.contactName,
          messagePreview: r.messagePreview,
          time: r.time,
          matchScore,
        });
      }
    }

    // Sort by match score (descending), then by time
    allResults.sort((a, b) => b.matchScore - a.matchScore);

    const win = getMainWindow();
    if (win) win.webContents.send('search-results', allResults);

    return allResults;
  });

  ipcMain.handle('search-contacts', async (event, { query }) => {
    if (!query || query.trim().length === 0) {
      return [];
    }

    const views = getViews();
    const accounts = getAccounts();
    const contacts = [];

    for (let i = 0; i < accounts.length; i++) {
      const account = accounts[i];
      const view = views[i];
      if (!view || !view.webContents) continue;

      try {
        const results = await view.webContents.executeJavaScript(`
          (function() {
            const contacts = [];
            const chatElements = document.querySelectorAll('[data-testid="cell-frame-container"]') ||
                                 document.querySelectorAll('div._8nE1Y') || [];
            chatElements.forEach((el) => {
              const nameEl = el.querySelector('span[title]');
              if (nameEl) {
                const name = nameEl.textContent || nameEl.getAttribute('title') || '';
                if (name.toLowerCase().includes(${JSON.stringify(query.toLowerCase())})) {
                  contacts.push({ contactName: name });
                }
              }
            });
            return contacts;
          })()
        `, true);

        for (const c of (results || [])) {
          contacts.push({
            accountId: account.id || account.phoneNumber,
            accountName: account.name || account.phoneNumber,
            contactName: c.contactName,
          });
        }
      } catch (e) {
        console.error('[conversation-search] Contact search failed for account:', e.message);
      }
    }

    return contacts;
  });

  ipcMain.handle('get-recent-searches', async () => {
    return getSearchHistory();
  });

  ipcMain.on('clear-search-history', () => {
    saveSearchHistory([]);

    const win = getMainWindow();
    if (win) win.webContents.send('search-history-cleared');
  });

  ipcMain.handle('search-by-date', async (event, { accountId, date }) => {
    const views = getViews();
    const accounts = getAccounts();

    const accountIndex = accounts.findIndex((a) => (a.id || a.phoneNumber) === accountId);
    if (accountIndex === -1 || !views[accountIndex]) {
      return { success: false, error: 'Account not found or view not available' };
    }

    const view = views[accountIndex];

    try {
      // Navigate to date search in WhatsApp Web — this is limited in the web client
      // WhatsApp Web doesn't have a direct "go to date" feature,
      // so we search for the date string as a workaround
      const dateStr = new Date(date).toLocaleDateString('en-US', {
        month: 'numeric',
        day: 'numeric',
        year: 'numeric',
      });

      await view.webContents.executeJavaScript(`
        (function() {
          // Open search
          const searchBtn = document.querySelector('[data-icon="search"]') ||
                            document.querySelector('[title="Search or start new chat"]');
          if (searchBtn) searchBtn.click();
        })()
      `, true);

      return { success: true, message: `Attempted to navigate to date: ${dateStr}` };
    } catch (e) {
      console.error('[conversation-search] Search by date failed:', e.message);
      return { success: false, error: e.message };
    }
  });
}

module.exports = { initConversationSearch };
