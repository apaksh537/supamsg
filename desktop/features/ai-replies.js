const Anthropic = require('@anthropic-ai/sdk');
const fs = require('fs');
const path = require('path');

const MODEL = 'claude-sonnet-4-20250514';

function getApiKey(app) {
  try {
    const settingsPath = path.join(app.getPath('userData'), 'settings.json');
    if (!fs.existsSync(settingsPath)) return null;
    const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));
    return settings.anthropicApiKey || null;
  } catch {
    return null;
  }
}

function createClient(app) {
  const apiKey = getApiKey(app);
  if (!apiKey) return null;
  return new Anthropic({ apiKey });
}

function initAiReplies({ app, ipcMain, getMainWindow, getViews, getActiveAccountId }) {

  // 1. Smart Reply Suggestions
  ipcMain.handle('ai-suggest-replies', async (_event, { messages }) => {
    const client = createClient(app);
    if (!client) return { error: 'API key not configured. Set it in Settings.' };

    try {
      const conversation = messages
        .map((m) => `${m.isOutgoing ? 'You' : m.sender}: ${m.text}`)
        .join('\n');

      const response = await client.messages.create({
        model: MODEL,
        max_tokens: 300,
        system: 'You are a helpful WhatsApp reply assistant. Given the conversation, suggest 3 short, natural reply options. Return JSON array of 3 strings.',
        messages: [{ role: 'user', content: conversation }],
      });

      const text = response.content[0].text.trim();
      const replies = JSON.parse(text);
      return { replies };
    } catch (err) {
      return { error: err.message };
    }
  });

  // 2. Summarize Conversation
  ipcMain.handle('ai-summarize', async (_event, { messages }) => {
    const client = createClient(app);
    if (!client) return { error: 'API key not configured. Set it in Settings.' };

    try {
      const conversation = messages
        .map((m) => `${m.isOutgoing ? 'You' : m.sender}: ${m.text}`)
        .join('\n');

      const response = await client.messages.create({
        model: MODEL,
        max_tokens: 500,
        system: 'Summarize the following WhatsApp conversation in 2-3 concise bullet points. Return only the bullet points.',
        messages: [{ role: 'user', content: conversation }],
      });

      const summary = response.content[0].text.trim();
      return { summary };
    } catch (err) {
      return { error: err.message };
    }
  });

  // 3. Translate Message
  ipcMain.handle('ai-translate', async (_event, { text, targetLanguage }) => {
    const client = createClient(app);
    if (!client) return { error: 'API key not configured. Set it in Settings.' };

    try {
      const response = await client.messages.create({
        model: MODEL,
        max_tokens: 300,
        system: `Translate the following message to ${targetLanguage}. Return only the translated text, nothing else.`,
        messages: [{ role: 'user', content: text }],
      });

      const translated = response.content[0].text.trim();
      return { translated };
    } catch (err) {
      return { error: err.message };
    }
  });

  // 4. Draft Reply
  ipcMain.handle('ai-draft-reply', async (_event, { messages, instruction }) => {
    const client = createClient(app);
    if (!client) return { error: 'API key not configured. Set it in Settings.' };

    try {
      const conversation = messages
        .map((m) => `${m.isOutgoing ? 'You' : m.sender}: ${m.text}`)
        .join('\n');

      const response = await client.messages.create({
        model: MODEL,
        max_tokens: 300,
        system: 'You are a WhatsApp reply drafter. Given the conversation and the user\'s instruction, draft a natural, concise reply message. Return only the reply text.',
        messages: [
          {
            role: 'user',
            content: `Conversation:\n${conversation}\n\nInstruction: ${instruction}`,
          },
        ],
      });

      const draft = response.content[0].text.trim();
      return { draft };
    } catch (err) {
      return { error: err.message };
    }
  });

  // 5. Sentiment Analysis
  ipcMain.handle('ai-analyze-sentiment', async (_event, { messages }) => {
    const client = createClient(app);
    if (!client) return { error: 'API key not configured. Set it in Settings.' };

    try {
      const conversation = messages
        .map((m) => `${m.isOutgoing ? 'You' : m.sender}: ${m.text}`)
        .join('\n');

      const response = await client.messages.create({
        model: MODEL,
        max_tokens: 300,
        system: 'Analyze the sentiment of this WhatsApp conversation. Return a JSON object with two fields: "sentiment" (one of "positive", "negative", "neutral", or "urgent") and "summary" (a brief one-sentence explanation).',
        messages: [{ role: 'user', content: conversation }],
      });

      const text = response.content[0].text.trim();
      const result = JSON.parse(text);
      return { sentiment: result.sentiment, summary: result.summary };
    } catch (err) {
      return { error: err.message };
    }
  });

  // 6. Scrape Active Chat
  ipcMain.handle('ai-get-chat-messages', async () => {
    try {
      const accountId = getActiveAccountId();
      if (!accountId) return { error: 'No active account.' };

      const views = getViews();
      const view = views[accountId];
      if (!view) return { error: 'No active view found for account.' };

      const result = await view.webContents.executeJavaScript(`
        (function() {
          const containers = document.querySelectorAll('[data-testid="msg-container"]');
          const messages = [];
          containers.forEach(function(el) {
            const isOutgoing = !!el.closest('.message-out');
            const textEl = el.querySelector('.selectable-text');
            const text = textEl ? textEl.innerText : '';
            const timeEl = el.querySelector('[data-testid="msg-meta"] span');
            const time = timeEl ? timeEl.innerText : '';
            const senderEl = el.querySelector('[data-testid="msg-header"] span');
            const sender = isOutgoing ? 'You' : (senderEl ? senderEl.innerText : 'Unknown');
            if (text) {
              messages.push({ sender: sender, text: text, time: time, isOutgoing: isOutgoing });
            }
          });
          return messages;
        })();
      `);

      return result;
    } catch (err) {
      return { error: err.message };
    }
  });
}

module.exports = { initAiReplies };
