const path = require('path');
const fs = require('fs');
const uuidv4 = () => require('crypto').randomUUID();

function initWhatsappBusinessApi({ app, ipcMain, getMainWindow, getViews, getActiveAccountId, getAccounts }) {
  const userDataPath = app.getPath('userData');
  const apiAccountsPath = path.join(userDataPath, 'business-api-accounts.json');
  const apiMessagesPath = path.join(userDataPath, 'business-api-messages.json');

  // --- Helpers ---

  function readJSON(filePath, fallback = []) {
    try {
      if (fs.existsSync(filePath)) {
        return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
      }
    } catch (e) {
      console.error(`[whatsapp-business-api] Failed to read ${filePath}:`, e.message);
    }
    return fallback;
  }

  function writeJSON(filePath, data) {
    try {
      fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
    } catch (e) {
      console.error(`[whatsapp-business-api] Failed to write ${filePath}:`, e.message);
    }
  }

  function getApiAccounts() {
    return readJSON(apiAccountsPath, []);
  }

  function saveApiAccounts(accounts) {
    writeJSON(apiAccountsPath, accounts);
  }

  function getApiMessages() {
    return readJSON(apiMessagesPath, []);
  }

  function saveApiMessages(messages) {
    writeJSON(apiMessagesPath, messages);
  }

  function findAccount(apiAccountId) {
    const accounts = getApiAccounts();
    return accounts.find((a) => a.id === apiAccountId);
  }

  function logMessage(entry) {
    const messages = getApiMessages();
    messages.push(entry);
    // Keep only last 5000 messages
    if (messages.length > 5000) {
      messages.splice(0, messages.length - 5000);
    }
    saveApiMessages(messages);
  }

  // --- API Calls ---

  async function sendMetaMessage(account, to, body) {
    const url = `https://graph.facebook.com/v18.0/${account.phoneNumberId}/messages`;
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${account.apiKey}`,
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        to,
        type: 'text',
        text: { body },
      }),
    });

    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.error?.message || `API error: ${response.status}`);
    }
    return { success: true, messageId: data.messages?.[0]?.id || null };
  }

  async function sendTwilioMessage(account, to, body) {
    // Twilio WhatsApp API format
    const url = `https://api.twilio.com/2010-04-01/Accounts/${account.businessId}/Messages.json`;
    const auth = Buffer.from(`${account.businessId}:${account.apiKey}`).toString('base64');
    const params = new URLSearchParams();
    params.append('From', `whatsapp:${account.phoneNumber}`);
    params.append('To', `whatsapp:${to}`);
    params.append('Body', body);

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Basic ${auth}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: params.toString(),
    });

    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.message || `Twilio error: ${response.status}`);
    }
    return { success: true, messageId: data.sid || null };
  }

  async function send360DialogMessage(account, to, body) {
    const url = 'https://waba.360dialog.io/v1/messages';
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'D360-API-KEY': account.apiKey,
      },
      body: JSON.stringify({
        to,
        type: 'text',
        text: { body },
      }),
    });

    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.meta?.developer_message || `360dialog error: ${response.status}`);
    }
    return { success: true, messageId: data.messages?.[0]?.id || null };
  }

  async function sendMessage(account, to, text) {
    switch (account.apiProvider) {
      case 'meta':
        return sendMetaMessage(account, to, text);
      case 'twilio':
        return sendTwilioMessage(account, to, text);
      case '360dialog':
        return send360DialogMessage(account, to, text);
      default:
        throw new Error(`Unsupported API provider: ${account.apiProvider}`);
    }
  }

  async function sendMetaTemplate(account, to, templateName, languageCode, parameters) {
    const url = `https://graph.facebook.com/v18.0/${account.phoneNumberId}/messages`;
    const components = [];
    if (parameters && parameters.length > 0) {
      components.push({
        type: 'body',
        parameters: parameters.map((p) => ({ type: 'text', text: p })),
      });
    }

    const body = {
      messaging_product: 'whatsapp',
      to,
      type: 'template',
      template: {
        name: templateName,
        language: { code: languageCode || 'en_US' },
      },
    };
    if (components.length > 0) {
      body.template.components = components;
    }

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${account.apiKey}`,
      },
      body: JSON.stringify(body),
    });

    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.error?.message || `API error: ${response.status}`);
    }
    return { success: true, messageId: data.messages?.[0]?.id || null };
  }

  async function fetchMetaTemplates(account) {
    const url = `https://graph.facebook.com/v18.0/${account.businessId}/message_templates`;
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${account.apiKey}`,
      },
    });

    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.error?.message || `API error: ${response.status}`);
    }
    return data.data || [];
  }

  // --- IPC Handlers ---

  ipcMain.handle('get-api-accounts', async () => {
    const accounts = getApiAccounts();
    // Return accounts without exposing full API keys
    return accounts.map((a) => ({
      ...a,
      apiKey: a.apiKey ? `${a.apiKey.substring(0, 8)}...` : '',
    }));
  });

  ipcMain.on('save-api-account', (event, account) => {
    const accounts = getApiAccounts();
    if (!account.id) {
      account.id = uuidv4();
    }

    const idx = accounts.findIndex((a) => a.id === account.id);
    if (idx !== -1) {
      // Preserve the existing API key if the incoming one is masked
      if (account.apiKey && account.apiKey.endsWith('...')) {
        account.apiKey = accounts[idx].apiKey;
      }
      accounts[idx] = account;
    } else {
      accounts.push(account);
    }
    saveApiAccounts(accounts);

    const win = getMainWindow();
    if (win) win.webContents.send('api-accounts-updated');
  });

  ipcMain.on('remove-api-account', (event, { id }) => {
    let accounts = getApiAccounts();
    accounts = accounts.filter((a) => a.id !== id);
    saveApiAccounts(accounts);

    const win = getMainWindow();
    if (win) win.webContents.send('api-accounts-updated');
  });

  ipcMain.handle('send-api-message', async (event, { apiAccountId, to, text }) => {
    const account = findAccount(apiAccountId);
    if (!account) {
      return { success: false, error: 'API account not found' };
    }

    try {
      const result = await sendMessage(account, to, text);

      logMessage({
        id: uuidv4(),
        apiAccountId,
        to,
        text,
        type: 'text',
        direction: 'outgoing',
        messageId: result.messageId,
        timestamp: new Date().toISOString(),
        status: 'sent',
      });

      return result;
    } catch (e) {
      console.error('[whatsapp-business-api] Send message failed:', e.message);

      logMessage({
        id: uuidv4(),
        apiAccountId,
        to,
        text,
        type: 'text',
        direction: 'outgoing',
        timestamp: new Date().toISOString(),
        status: 'failed',
        error: e.message,
      });

      return { success: false, error: e.message };
    }
  });

  ipcMain.handle('send-api-template', async (event, { apiAccountId, to, templateName, languageCode, parameters }) => {
    const account = findAccount(apiAccountId);
    if (!account) {
      return { success: false, error: 'API account not found' };
    }

    try {
      let result;
      if (account.apiProvider === 'meta') {
        result = await sendMetaTemplate(account, to, templateName, languageCode, parameters);
      } else {
        // For non-Meta providers, template sending varies — use text fallback
        const paramText = parameters ? parameters.join(', ') : '';
        result = await sendMessage(account, to, `[Template: ${templateName}] ${paramText}`);
      }

      logMessage({
        id: uuidv4(),
        apiAccountId,
        to,
        templateName,
        type: 'template',
        direction: 'outgoing',
        messageId: result.messageId,
        timestamp: new Date().toISOString(),
        status: 'sent',
      });

      return result;
    } catch (e) {
      console.error('[whatsapp-business-api] Send template failed:', e.message);
      return { success: false, error: e.message };
    }
  });

  ipcMain.handle('get-api-templates', async (event, { apiAccountId }) => {
    const account = findAccount(apiAccountId);
    if (!account) {
      return { error: 'API account not found', templates: [] };
    }

    try {
      if (account.apiProvider === 'meta') {
        const templates = await fetchMetaTemplates(account);
        return { templates };
      }
      // Other providers: not implemented yet
      return { templates: [], message: `Template listing not supported for ${account.apiProvider} yet` };
    } catch (e) {
      console.error('[whatsapp-business-api] Fetch templates failed:', e.message);
      return { error: e.message, templates: [] };
    }
  });

  ipcMain.handle('get-api-messages', async (event, { apiAccountId, limit }) => {
    const messages = getApiMessages();
    const filtered = apiAccountId
      ? messages.filter((m) => m.apiAccountId === apiAccountId)
      : messages;
    const messageLimit = limit || 50;
    return filtered.slice(-messageLimit);
  });
}

module.exports = { initWhatsappBusinessApi };
