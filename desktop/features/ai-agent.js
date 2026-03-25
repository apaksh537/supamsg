// AI Agent Mode: autonomous AI that handles WhatsApp conversations end-to-end
// Uses Claude API with configurable personality, context, FAQs, and handoff rules

const path = require('path');
const fs = require('fs');
const https = require('https');

let agentsPath;
let settingsPath;
let agents = [];
// Map<string, { history: [{ role, content }], replyCount, lastActivity }> keyed by `${accountId}:${senderName}`
const conversationHistory = new Map();
// Map<string, { count, firstReplyAt }> for rate limiting keyed by `${accountId}:${senderName}`
const replyCounters = new Map();

let getViewsRef = null;
let getMainWindowRef = null;

function initAiAgent({ app, ipcMain, getMainWindow, getViews, getActiveAccountId }) {
  agentsPath = path.join(app.getPath('userData'), 'ai-agents.json');
  settingsPath = path.join(app.getPath('userData'), 'settings.json');
  getViewsRef = getViews;
  getMainWindowRef = getMainWindow;

  loadAgents();

  ipcMain.handle('get-agents', () => agents);

  ipcMain.on('save-agent', (_event, agent) => {
    const existing = agents.find((a) => a.id === agent.id);
    if (existing) {
      Object.assign(existing, agent);
    } else {
      agent.id = `agent-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
      agent.createdAt = new Date().toISOString();
      agents.push(agent);
    }
    saveAgents();
    const win = getMainWindow();
    if (win && !win.isDestroyed()) {
      win.webContents.send('agents-updated', agents);
    }
  });

  ipcMain.on('delete-agent', (_event, { agentId }) => {
    agents = agents.filter((a) => a.id !== agentId);
    saveAgents();
    const win = getMainWindow();
    if (win && !win.isDestroyed()) {
      win.webContents.send('agents-updated', agents);
    }
  });

  ipcMain.on('toggle-agent', (_event, { agentId }) => {
    const agent = agents.find((a) => a.id === agentId);
    if (agent) {
      agent.enabled = !agent.enabled;
      saveAgents();
      const win = getMainWindow();
      if (win && !win.isDestroyed()) {
        win.webContents.send('agents-updated', agents);
      }
    }
  });

  ipcMain.handle('get-agent-conversations', () => {
    const conversations = [];
    for (const [key, value] of conversationHistory.entries()) {
      const [accountId, senderName] = key.split(':');
      conversations.push({
        accountId,
        senderName,
        messageCount: value.history.length,
        replyCount: value.replyCount,
        lastActivity: value.lastActivity,
      });
    }
    return conversations.sort((a, b) => new Date(b.lastActivity) - new Date(a.lastActivity));
  });

  ipcMain.handle('get-agent-stats', (_event, { agentId }) => {
    const agent = agents.find((a) => a.id === agentId);
    if (!agent) return { error: 'Agent not found' };

    let totalConversations = 0;
    let totalHandoffs = 0;
    let totalReplies = 0;

    for (const [key, value] of conversationHistory.entries()) {
      const [accountId] = key.split(':');
      if (accountId === agent.accountId) {
        totalConversations++;
        totalReplies += value.replyCount;
      }
    }

    return {
      agentId,
      agentName: agent.name,
      totalConversations,
      totalHandoffs,
      totalReplies,
      averageRepliesPerConversation: totalConversations > 0 ? Math.round(totalReplies / totalConversations * 10) / 10 : 0,
    };
  });

  // Cleanup stale conversation histories (older than 1 hour of inactivity)
  setInterval(() => {
    const cutoff = Date.now() - (60 * 60 * 1000);
    for (const [key, value] of conversationHistory.entries()) {
      if (new Date(value.lastActivity).getTime() < cutoff) {
        conversationHistory.delete(key);
        replyCounters.delete(key);
      }
    }
  }, 5 * 60 * 1000);
}

function loadAgents() {
  try {
    if (fs.existsSync(agentsPath)) {
      agents = JSON.parse(fs.readFileSync(agentsPath, 'utf-8'));
    }
  } catch (err) {
    console.error('[ai-agent] Failed to load agents:', err.message);
    agents = [];
  }
}

function saveAgents() {
  try {
    fs.writeFileSync(agentsPath, JSON.stringify(agents, null, 2));
  } catch (err) {
    console.error('[ai-agent] Failed to save agents:', err.message);
  }
}

// TODO: API key is stored in plain text in settings.json. A future update should
// use Electron's safeStorage API to encrypt the key at rest. See:
// https://www.electronjs.org/docs/latest/api/safe-storage
function getApiKey() {
  try {
    if (fs.existsSync(settingsPath)) {
      const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));
      return settings.anthropicApiKey || '';
    }
  } catch (_) { /* ignore */ }
  return '';
}

function isWithinActiveHours(agent) {
  if (!agent.activeHours) return true;
  const now = new Date();
  const currentTime = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
  const start = agent.activeHours.start || '00:00';
  const end = agent.activeHours.end || '23:59';

  if (start <= end) {
    return currentTime >= start && currentTime <= end;
  }
  // Overnight range (e.g., 22:00 - 06:00)
  return currentTime >= start || currentTime <= end;
}

function callClaudeApi(messages, systemPrompt) {
  return new Promise((resolve, reject) => {
    const apiKey = getApiKey();
    if (!apiKey) {
      return reject(new Error('Anthropic API key not configured'));
    }

    const body = JSON.stringify({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1024,
      system: systemPrompt,
      messages,
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

async function injectMessage(views, accountId, text) {
  if (!views[accountId]) return;
  try {
    await views[accountId].webContents.executeJavaScript(`
      (function() {
        const editableDiv = document.querySelector('div[contenteditable="true"][data-tab="10"]');
        if (!editableDiv) return false;
        editableDiv.focus();
        document.execCommand('insertText', false, ${JSON.stringify(text)});
        setTimeout(() => {
          const sendBtn = document.querySelector('button[data-tab="11"]') || document.querySelector('span[data-icon="send"]');
          if (sendBtn) sendBtn.click();
        }, 300);
        return true;
      })();
    `);
  } catch (err) {
    console.error('[ai-agent] Failed to inject message:', err.message);
  }
}

async function processAgentMessage(accountId, messageText, senderName, { getViews, getMainWindow } = {}) {
  const views = (getViews || getViewsRef) ? (getViews || getViewsRef)() : {};
  const win = (getMainWindow || getMainWindowRef) ? (getMainWindow || getMainWindowRef)() : null;

  // Find enabled agent for this account
  const agent = agents.find((a) => a.accountId === accountId && a.enabled);
  if (!agent) return null;

  // Check active hours
  if (!isWithinActiveHours(agent)) {
    return null;
  }

  const stateKey = `${accountId}:${senderName}`;
  const now = Date.now();

  // Check/reset reply counter (reset after 1 hour of inactivity)
  let counter = replyCounters.get(stateKey);
  if (counter && (now - counter.firstReplyAt) > 60 * 60 * 1000) {
    replyCounters.delete(stateKey);
    counter = null;
  }
  if (!counter) {
    counter = { count: 0, firstReplyAt: now };
    replyCounters.set(stateKey, counter);
  }

  // Check max auto-replies
  const maxReplies = agent.maxAutoReplies || 10;
  if (counter.count >= maxReplies) {
    if (win && !win.isDestroyed()) {
      win.webContents.send('agent-max-replies', {
        agentId: agent.id,
        agentName: agent.name,
        senderName,
        accountId,
        replyCount: counter.count,
      });
    }
    return { type: 'max_replies_reached', senderName, count: counter.count };
  }

  // Build conversation history
  let convo = conversationHistory.get(stateKey);
  if (!convo) {
    convo = { history: [], replyCount: 0, lastActivity: new Date().toISOString() };
    conversationHistory.set(stateKey, convo);
  }

  convo.history.push({ role: 'user', content: messageText });
  convo.lastActivity = new Date().toISOString();

  // Keep history manageable (last 20 messages)
  if (convo.history.length > 20) {
    convo.history = convo.history.slice(-20);
  }

  // Build system prompt
  let systemPrompt = agent.personality || 'You are a helpful WhatsApp assistant.';
  if (agent.context) {
    systemPrompt += `\n\nContext: ${agent.context}`;
  }
  if (agent.faqs && agent.faqs.length > 0) {
    systemPrompt += '\n\nFAQs:';
    for (const faq of agent.faqs) {
      systemPrompt += `\nQ: ${faq.q}\nA: ${faq.a}`;
    }
  }
  systemPrompt += '\n\nKeep responses concise and natural for WhatsApp. Do not use markdown formatting.';

  try {
    const response = await callClaudeApi(convo.history, systemPrompt);

    // Check for handoff keywords
    const handoffKeywords = agent.handoffKeywords || [];
    const lowerResponse = response.toLowerCase();
    const lowerMessage = messageText.toLowerCase();
    const needsHandoff = handoffKeywords.some((kw) =>
      lowerMessage.includes(kw.toLowerCase()) || lowerResponse.includes(kw.toLowerCase())
    );

    if (needsHandoff) {
      if (win && !win.isDestroyed()) {
        win.webContents.send('agent-handoff', {
          agentId: agent.id,
          agentName: agent.name,
          senderName,
          accountId,
          reason: 'Handoff keyword detected',
          lastMessage: messageText,
        });
      }
      conversationHistory.delete(stateKey);
      replyCounters.delete(stateKey);
      return { type: 'handoff', senderName, reason: 'keyword_match' };
    }

    // Send the response
    await injectMessage(views, accountId, response);

    // Update tracking
    convo.history.push({ role: 'assistant', content: response });
    convo.replyCount++;
    counter.count++;

    return { type: 'reply', senderName, response };
  } catch (err) {
    console.error('[ai-agent] Failed to process message:', err.message);
    return { type: 'error', error: err.message };
  }
}

module.exports = { initAiAgent, processAgentMessage };
