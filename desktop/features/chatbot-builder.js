// No-code Chatbot Builder: conversation flow trees with trigger keywords
// Supports node types: message, question, condition, action, handoff

const path = require('path');
const fs = require('fs');

let botsPath;
let bots = [];
// Map<string, { botId, currentNodeId, lastResponseTime, waitingForAnswer }> keyed by `${accountId}:${senderName}`
const conversationStates = new Map();

function initChatbotBuilder({ app, ipcMain, getMainWindow, getViews, getActiveAccountId }) {
  botsPath = path.join(app.getPath('userData'), 'chatbots.json');
  loadBots();

  ipcMain.handle('get-bots', () => bots);

  ipcMain.on('save-bot', (_event, bot) => {
    const existing = bots.find((b) => b.id === bot.id);
    if (existing) {
      Object.assign(existing, bot);
    } else {
      bot.id = `bot-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
      bot.createdAt = new Date().toISOString();
      bots.push(bot);
    }
    saveBots();
    const win = getMainWindow();
    if (win && !win.isDestroyed()) {
      win.webContents.send('bots-updated', bots);
    }
  });

  ipcMain.on('delete-bot', (_event, { botId }) => {
    bots = bots.filter((b) => b.id !== botId);
    saveBots();
    const win = getMainWindow();
    if (win && !win.isDestroyed()) {
      win.webContents.send('bots-updated', bots);
    }
  });

  ipcMain.on('toggle-bot', (_event, { botId }) => {
    const bot = bots.find((b) => b.id === botId);
    if (bot) {
      bot.enabled = !bot.enabled;
      saveBots();
      const win = getMainWindow();
      if (win && !win.isDestroyed()) {
        win.webContents.send('bots-updated', bots);
      }
    }
  });
}

function loadBots() {
  try {
    if (fs.existsSync(botsPath)) {
      bots = JSON.parse(fs.readFileSync(botsPath, 'utf-8'));
    }
  } catch (err) {
    console.error('[chatbot-builder] Failed to load bots:', err.message);
    bots = [];
  }
}

function saveBots() {
  try {
    fs.writeFileSync(botsPath, JSON.stringify(bots, null, 2));
  } catch (err) {
    console.error('[chatbot-builder] Failed to save bots:', err.message);
  }
}

function findNodeById(nodes, nodeId) {
  return nodes.find((n) => n.id === nodeId) || null;
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
    console.error('[chatbot-builder] Failed to inject message:', err.message);
  }
}

async function processBotMessage(accountId, messageText, senderName, { getViews, getMainWindow } = {}) {
  const stateKey = `${accountId}:${senderName}`;
  const now = Date.now();

  // Rate limit: max 1 response per sender per 30 seconds
  const existingState = conversationStates.get(stateKey);
  if (existingState && existingState.lastResponseTime && (now - existingState.lastResponseTime) < 30000) {
    return null;
  }

  const enabledBots = bots.filter((b) => b.accountId === accountId && b.enabled);
  if (enabledBots.length === 0) return null;

  const views = getViews ? getViews() : {};
  const win = getMainWindow ? getMainWindow() : null;
  const lowerMsg = messageText.toLowerCase().trim();

  // Check if we have an ongoing conversation
  if (existingState && existingState.botId && existingState.waitingForAnswer) {
    const bot = bots.find((b) => b.id === existingState.botId);
    if (bot && bot.enabled) {
      return await handleNodeResponse(bot, existingState, lowerMsg, stateKey, views, accountId, win, senderName, now);
    }
  }

  // Find a bot whose trigger keywords match
  for (const bot of enabledBots) {
    const triggers = (bot.triggerKeywords || []).map((k) => k.toLowerCase());
    const matched = triggers.length === 0 || triggers.some((kw) => lowerMsg.includes(kw));
    if (!matched) continue;

    // Start from the first node
    if (!bot.nodes || bot.nodes.length === 0) continue;
    const firstNode = bot.nodes[0];

    conversationStates.set(stateKey, {
      botId: bot.id,
      currentNodeId: firstNode.id,
      lastResponseTime: now,
      waitingForAnswer: false,
    });

    return await processNode(bot, firstNode, lowerMsg, stateKey, views, accountId, win, senderName, now);
  }

  return null;
}

async function processNode(bot, node, messageText, stateKey, views, accountId, win, senderName, now) {
  if (!node) {
    conversationStates.delete(stateKey);
    return null;
  }

  switch (node.type) {
    case 'message': {
      const text = (node.text || '').replace(/\{name\}/g, senderName);
      await injectMessage(views, accountId, text);
      // Move to next node if options exist
      if (node.options && node.options.length > 0 && node.options[0].nextNodeId) {
        const nextNode = findNodeById(bot.nodes, node.options[0].nextNodeId);
        return await processNode(bot, nextNode, messageText, stateKey, views, accountId, win, senderName, now);
      }
      conversationStates.delete(stateKey);
      return { type: 'message', text };
    }

    case 'question': {
      const text = (node.text || '').replace(/\{name\}/g, senderName);
      await injectMessage(views, accountId, text);
      conversationStates.set(stateKey, {
        botId: bot.id,
        currentNodeId: node.id,
        lastResponseTime: now,
        waitingForAnswer: true,
      });
      return { type: 'question', text };
    }

    case 'condition': {
      const cond = node.condition || {};
      let matches = false;
      const value = (cond.value || '').toLowerCase();
      switch (cond.operator) {
        case 'contains':
          matches = messageText.includes(value);
          break;
        case 'equals':
          matches = messageText === value;
          break;
        case 'starts_with':
          matches = messageText.startsWith(value);
          break;
        case 'not_contains':
          matches = !messageText.includes(value);
          break;
        default:
          matches = messageText.includes(value);
      }
      const nextId = matches ? cond.trueNodeId : cond.falseNodeId;
      const nextNode = findNodeById(bot.nodes, nextId);
      return await processNode(bot, nextNode, messageText, stateKey, views, accountId, win, senderName, now);
    }

    case 'action': {
      const action = node.action || {};
      if (action.type === 'notify' && win && !win.isDestroyed()) {
        win.webContents.send('bot-action-notify', {
          botId: bot.id,
          botName: bot.name,
          senderName,
          actionValue: action.value,
        });
      }
      // Move to next node
      if (node.options && node.options.length > 0 && node.options[0].nextNodeId) {
        const nextNode = findNodeById(bot.nodes, node.options[0].nextNodeId);
        return await processNode(bot, nextNode, messageText, stateKey, views, accountId, win, senderName, now);
      }
      conversationStates.delete(stateKey);
      return { type: 'action', action: action.type };
    }

    case 'handoff': {
      if (win && !win.isDestroyed()) {
        win.webContents.send('bot-handoff', {
          botId: bot.id,
          botName: bot.name,
          senderName,
          accountId,
        });
      }
      conversationStates.delete(stateKey);
      return { type: 'handoff', senderName };
    }

    default:
      conversationStates.delete(stateKey);
      return null;
  }
}

async function handleNodeResponse(bot, state, messageText, stateKey, views, accountId, win, senderName, now) {
  const currentNode = findNodeById(bot.nodes, state.currentNodeId);
  if (!currentNode || !currentNode.options) {
    conversationStates.delete(stateKey);
    return null;
  }

  // Try to match user answer to one of the options
  const matchedOption = currentNode.options.find((opt) =>
    messageText.includes((opt.label || '').toLowerCase())
  );

  if (matchedOption && matchedOption.nextNodeId) {
    const nextNode = findNodeById(bot.nodes, matchedOption.nextNodeId);
    conversationStates.set(stateKey, {
      botId: bot.id,
      currentNodeId: matchedOption.nextNodeId,
      lastResponseTime: now,
      waitingForAnswer: false,
    });
    return await processNode(bot, nextNode, messageText, stateKey, views, accountId, win, senderName, now);
  }

  // No match — re-ask or default to first option
  if (currentNode.options.length > 0 && currentNode.options[0].nextNodeId) {
    const nextNode = findNodeById(bot.nodes, currentNode.options[0].nextNodeId);
    conversationStates.set(stateKey, {
      botId: bot.id,
      currentNodeId: currentNode.options[0].nextNodeId,
      lastResponseTime: now,
      waitingForAnswer: false,
    });
    return await processNode(bot, nextNode, messageText, stateKey, views, accountId, win, senderName, now);
  }

  conversationStates.delete(stateKey);
  return null;
}

module.exports = { initChatbotBuilder, processBotMessage };
