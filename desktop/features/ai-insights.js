// AI-Powered Customer Insights: analyze conversations for business intelligence
// Uses Claude API for sentiment analysis, topic clustering, churn detection

const path = require('path');
const fs = require('fs');
const https = require('https');

let cachePath;
let settingsPath;
let insightsCache = {};
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

let getViewsRef = null;
let getAccountsRef = null;

function initAiInsights({ app, ipcMain, getViews, getAccounts }) {
  cachePath = path.join(app.getPath('userData'), 'ai-insights-cache.json');
  settingsPath = path.join(app.getPath('userData'), 'settings.json');
  getViewsRef = getViews;
  getAccountsRef = getAccounts;

  loadCache();

  ipcMain.handle('get-insights', async (_event, { accountId }) => {
    return await generateInsights(accountId);
  });

  ipcMain.handle('get-churn-risks', async () => {
    return await getChurnRisks();
  });

  ipcMain.handle('get-inactive-contacts', async (_event, { days }) => {
    return await getInactiveContacts(days || 7);
  });

  ipcMain.handle('get-topic-clusters', async () => {
    return await getTopicClusters();
  });

  ipcMain.handle('generate-weekly-report', async (_event, { accountId }) => {
    return await generateWeeklyReport(accountId);
  });
}

function loadCache() {
  try {
    if (fs.existsSync(cachePath)) {
      insightsCache = JSON.parse(fs.readFileSync(cachePath, 'utf-8'));
    }
  } catch (err) {
    console.error('[ai-insights] Failed to load cache:', err.message);
    insightsCache = {};
  }
}

function saveCache() {
  try {
    fs.writeFileSync(cachePath, JSON.stringify(insightsCache, null, 2));
  } catch (err) {
    console.error('[ai-insights] Failed to save cache:', err.message);
  }
}

function getApiKey() {
  try {
    if (fs.existsSync(settingsPath)) {
      const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));
      return settings.anthropicApiKey || '';
    }
  } catch (_) { /* ignore */ }
  return '';
}

function callClaudeApi(prompt) {
  return new Promise((resolve, reject) => {
    const apiKey = getApiKey();
    if (!apiKey) {
      return reject(new Error('Anthropic API key not configured. Set it in settings.'));
    }

    const body = JSON.stringify({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 4096,
      messages: [{ role: 'user', content: prompt }],
    });

    const req = https.request({
      hostname: 'api.anthropic.com',
      path: '/v1/messages',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'Content-Length': Buffer.byteLength(body),
      },
    }, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          if (parsed.error) {
            return reject(new Error(parsed.error.message));
          }
          const text = parsed.content?.[0]?.text || '';
          resolve(text);
        } catch (err) {
          reject(new Error('Failed to parse Claude API response'));
        }
      });
    });

    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

async function scrapeMessages(accountId) {
  const views = getViewsRef ? getViewsRef() : {};
  if (!views[accountId]) return [];

  try {
    return await views[accountId].webContents.executeJavaScript(`
      (function() {
        const rows = document.querySelectorAll('div.message-in, div.message-out');
        const msgs = [];
        const slice = Array.from(rows).slice(-100);
        for (const row of slice) {
          const textEl = row.querySelector('span.selectable-text');
          const timeEl = row.querySelector('span[data-testid="msg-time"]');
          msgs.push({
            direction: row.classList.contains('message-in') ? 'in' : 'out',
            text: textEl ? textEl.innerText : '',
            time: timeEl ? timeEl.innerText : '',
          });
        }
        return msgs;
      })();
    `);
  } catch (err) {
    console.error('[ai-insights] Failed to scrape messages:', err.message);
    return [];
  }
}

async function generateInsights(accountId) {
  // Check cache
  const cacheKey = `insights-${accountId}`;
  if (insightsCache[cacheKey] && (Date.now() - insightsCache[cacheKey].timestamp) < CACHE_TTL_MS) {
    return insightsCache[cacheKey].data;
  }

  const messages = await scrapeMessages(accountId);
  if (messages.length === 0) {
    return { error: 'No messages found to analyze' };
  }

  const conversationText = messages
    .map((m) => `[${m.direction === 'in' ? 'Customer' : 'You'}] ${m.text}`)
    .join('\n');

  const prompt = `Analyze these WhatsApp conversations and provide:
1) Customer sentiment trends
2) Top topics discussed
3) Customers who haven't been contacted in 7+ days
4) Potential upsell opportunities
5) At-risk customers showing frustration

Return as JSON with keys: sentimentTrends, topTopics, inactiveCustomers, upsellOpportunities, atRiskCustomers.

Conversations:
${conversationText}`;

  try {
    const response = await callClaudeApi(prompt);
    let data;
    try {
      // Try to extract JSON from the response
      const jsonMatch = response.match(/\{[\s\S]*\}/);
      data = jsonMatch ? JSON.parse(jsonMatch[0]) : { raw: response };
    } catch (_) {
      data = { raw: response };
    }

    insightsCache[cacheKey] = { timestamp: Date.now(), data };
    saveCache();
    return data;
  } catch (err) {
    return { error: err.message };
  }
}

async function getChurnRisks() {
  const cacheKey = 'churn-risks';
  if (insightsCache[cacheKey] && (Date.now() - insightsCache[cacheKey].timestamp) < CACHE_TTL_MS) {
    return insightsCache[cacheKey].data;
  }

  const accounts = getAccountsRef ? getAccountsRef() : [];
  const allMessages = [];

  for (const account of accounts) {
    const msgs = await scrapeMessages(account.id);
    allMessages.push({ accountId: account.id, accountName: account.name || account.id, messages: msgs });
  }

  if (allMessages.every((a) => a.messages.length === 0)) {
    return { risks: [], error: 'No messages found' };
  }

  const summary = allMessages
    .map((a) => `Account: ${a.accountName}\n${a.messages.slice(-20).map((m) => `[${m.direction}] ${m.text}`).join('\n')}`)
    .join('\n---\n');

  try {
    const response = await callClaudeApi(
      `Identify customers showing negative sentiment trends or churn risk from these WhatsApp conversations. Return as JSON with key "risks" containing array of { customerName, riskLevel: "high"|"medium"|"low", reason, lastActivity }.\n\n${summary}`
    );
    const jsonMatch = response.match(/\{[\s\S]*\}/);
    const data = jsonMatch ? JSON.parse(jsonMatch[0]) : { risks: [] };
    insightsCache[cacheKey] = { timestamp: Date.now(), data };
    saveCache();
    return data;
  } catch (err) {
    return { risks: [], error: err.message };
  }
}

async function getInactiveContacts(days) {
  // Read analytics data if available
  try {
    const analyticsPath = path.join(path.dirname(cachePath), 'analytics.json');
    if (fs.existsSync(analyticsPath)) {
      const analytics = JSON.parse(fs.readFileSync(analyticsPath, 'utf-8'));
      const cutoff = Date.now() - (days * 24 * 60 * 60 * 1000);
      const inactive = (analytics.contacts || []).filter((c) => {
        const lastContact = new Date(c.lastMessageAt || c.lastSeen || 0).getTime();
        return lastContact < cutoff;
      });
      return { contacts: inactive, days };
    }
  } catch (_) { /* ignore */ }

  return { contacts: [], days, message: 'No analytics data available' };
}

async function getTopicClusters() {
  const cacheKey = 'topic-clusters';
  if (insightsCache[cacheKey] && (Date.now() - insightsCache[cacheKey].timestamp) < CACHE_TTL_MS) {
    return insightsCache[cacheKey].data;
  }

  const accounts = getAccountsRef ? getAccountsRef() : [];
  const allTexts = [];

  for (const account of accounts) {
    const msgs = await scrapeMessages(account.id);
    allTexts.push(...msgs.filter((m) => m.text).map((m) => m.text));
  }

  if (allTexts.length === 0) {
    return { clusters: [] };
  }

  try {
    const response = await callClaudeApi(
      `Cluster the following messages by topic. Return JSON with key "clusters" containing array of { topic, messageCount, keywords: [], sampleMessages: [] }.\n\nMessages:\n${allTexts.slice(0, 200).join('\n')}`
    );
    const jsonMatch = response.match(/\{[\s\S]*\}/);
    const data = jsonMatch ? JSON.parse(jsonMatch[0]) : { clusters: [] };
    insightsCache[cacheKey] = { timestamp: Date.now(), data };
    saveCache();
    return data;
  } catch (err) {
    return { clusters: [], error: err.message };
  }
}

async function generateWeeklyReport(accountId) {
  const cacheKey = `weekly-report-${accountId}`;
  if (insightsCache[cacheKey] && (Date.now() - insightsCache[cacheKey].timestamp) < CACHE_TTL_MS) {
    return insightsCache[cacheKey].data;
  }

  const messages = await scrapeMessages(accountId);
  const inbound = messages.filter((m) => m.direction === 'in').length;
  const outbound = messages.filter((m) => m.direction === 'out').length;

  const conversationText = messages
    .map((m) => `[${m.direction === 'in' ? 'Customer' : 'You'}] ${m.text}`)
    .join('\n');

  try {
    const response = await callClaudeApi(
      `Generate a weekly summary report for these WhatsApp conversations. Include:
- Messages sent: ${outbound}, received: ${inbound}
- Response time estimates
- Top contacts
- Sentiment overview
- Key action items

Format as readable text, not JSON.

Conversations:
${conversationText}`
    );

    const data = {
      report: response,
      stats: { messagesSent: outbound, messagesReceived: inbound, totalMessages: messages.length },
      generatedAt: new Date().toISOString(),
    };

    insightsCache[cacheKey] = { timestamp: Date.now(), data };
    saveCache();
    return data;
  } catch (err) {
    return {
      report: `Weekly Report (Auto-generated)\n\nMessages sent: ${outbound}\nMessages received: ${inbound}\nTotal: ${messages.length}\n\nNote: AI analysis unavailable - ${err.message}`,
      stats: { messagesSent: outbound, messagesReceived: inbound, totalMessages: messages.length },
      generatedAt: new Date().toISOString(),
    };
  }
}

module.exports = { initAiInsights };
