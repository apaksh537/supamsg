// Payment collection via WhatsApp — send payment links in chat
// Supports Razorpay, Stripe, and UPI payment providers

const path = require('path');
const fs = require('fs');
const { net } = require('electron');

let configPath;
let historyPath;
let config = null;
let history = [];

function initPaymentCollection({ app, ipcMain, getMainWindow, getViews, getActiveAccountId }) {
  configPath = path.join(app.getPath('userData'), 'payment-config.json');
  historyPath = path.join(app.getPath('userData'), 'payment-history.json');
  loadConfig();
  loadHistory();

  ipcMain.handle('get-payment-config', () => {
    return config;
  });

  ipcMain.on('save-payment-config', (_event, { provider, apiKey, merchantId }) => {
    config = {
      provider,
      apiKey,
      merchantId,
      updatedAt: new Date().toISOString(),
    };
    saveConfig();
  });

  ipcMain.handle('create-payment-link', async (_event, { amount, currency, description, customerName, customerEmail }) => {
    if (!config || !config.provider) {
      throw new Error('Payment provider not configured');
    }

    let result;
    switch (config.provider) {
      case 'razorpay':
        result = await createRazorpayLink({ amount, currency, description, customerName, customerEmail });
        break;
      case 'stripe':
        result = await createStripeLink({ amount, currency, description, customerName, customerEmail });
        break;
      case 'upi':
        result = createUpiLink({ amount, currency, description, customerName });
        break;
      default:
        throw new Error(`Unsupported provider: ${config.provider}`);
    }

    const entry = {
      ...result,
      customerName,
      customerEmail,
      description,
      provider: config.provider,
      createdAt: new Date().toISOString(),
    };
    history.unshift(entry);
    saveHistory();

    return result;
  });

  ipcMain.on('send-payment-link', async (_event, { accountId, contactName, paymentUrl, message }) => {
    try {
      const views = getViews();
      const activeId = accountId || getActiveAccountId();
      const view = views[activeId];
      if (!view || view.webContents.isDestroyed()) return;

      const contact = contactName.replace(/'/g, "\\'");
      const fullMessage = (message || `Here is your payment link: ${paymentUrl}`).replace(/'/g, "\\'").replace(/\n/g, '\\n');

      await view.webContents.executeJavaScript(`
        (async () => {
          const searchBox = document.querySelector('div[contenteditable="true"][data-tab="3"]');
          if (!searchBox) throw new Error('Search box not found');
          searchBox.focus();
          document.execCommand('insertText', false, '${contact}');
          await new Promise(r => setTimeout(r, 1500));
          const contacts = document.querySelectorAll('span[title]');
          let found = false;
          for (const c of contacts) {
            if (c.title && c.title.toLowerCase().includes('${contact}'.toLowerCase())) {
              c.click();
              found = true;
              break;
            }
          }
          if (!found) throw new Error('Contact not found');
          await new Promise(r => setTimeout(r, 1000));
          const msgBox = document.querySelector('div[contenteditable="true"][data-tab="10"]');
          if (!msgBox) throw new Error('Message box not found');
          msgBox.focus();
          document.execCommand('insertText', false, '${fullMessage}');
          await new Promise(r => setTimeout(r, 300));
          const sendBtn = document.querySelector('span[data-icon="send"]');
          if (sendBtn) sendBtn.click();
        })();
      `);
    } catch (e) {
      console.error('Failed to send payment link:', e);
    }
  });

  ipcMain.handle('get-payment-history', () => {
    return history;
  });

  ipcMain.on('check-payment-status', async (_event, { paymentId, provider }) => {
    try {
      let status = 'unknown';
      if (provider === 'razorpay') {
        status = await checkRazorpayStatus(paymentId);
      } else if (provider === 'stripe') {
        status = await checkStripeStatus(paymentId);
      } else if (provider === 'upi') {
        status = 'manual_verification_required';
      }

      // Update history entry
      const entry = history.find((h) => h.id === paymentId);
      if (entry) {
        entry.status = status;
        entry.checkedAt = new Date().toISOString();
        saveHistory();
      }

      const mainWindow = getMainWindow();
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('payment-status-updated', { paymentId, status });
      }
    } catch (e) {
      console.error('Failed to check payment status:', e);
    }
  });
}

function createRazorpayLink({ amount, currency, description, customerName, customerEmail }) {
  return new Promise((resolve, reject) => {
    const postData = JSON.stringify({
      amount: Math.round(amount * 100), // Razorpay expects paise
      currency: currency || 'INR',
      description: description || 'Payment',
      customer: {
        name: customerName,
        email: customerEmail,
      },
    });

    const request = net.request({
      method: 'POST',
      url: 'https://api.razorpay.com/v1/payment_links',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Basic ' + Buffer.from(`${config.apiKey}:${config.merchantId}`).toString('base64'),
      },
    });

    let body = '';
    request.on('response', (response) => {
      response.on('data', (chunk) => { body += chunk.toString(); });
      response.on('end', () => {
        try {
          const data = JSON.parse(body);
          resolve({
            url: data.short_url || data.url,
            id: data.id,
            amount,
            status: data.status || 'created',
          });
        } catch (e) {
          reject(new Error('Invalid response from Razorpay'));
        }
      });
    });

    request.on('error', (err) => reject(err));
    request.write(postData);
    request.end();
  });
}

function createStripeLink({ amount, currency, description }) {
  return new Promise((resolve, reject) => {
    const params = new URLSearchParams();
    params.append('line_items[0][price_data][currency]', currency || 'usd');
    params.append('line_items[0][price_data][product_data][name]', description || 'Payment');
    params.append('line_items[0][price_data][unit_amount]', Math.round(amount * 100).toString());
    params.append('line_items[0][quantity]', '1');

    const request = net.request({
      method: 'POST',
      url: 'https://api.stripe.com/v1/payment_links',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Authorization': `Bearer ${config.apiKey}`,
      },
    });

    let body = '';
    request.on('response', (response) => {
      response.on('data', (chunk) => { body += chunk.toString(); });
      response.on('end', () => {
        try {
          const data = JSON.parse(body);
          resolve({
            url: data.url,
            id: data.id,
            amount,
            status: data.active ? 'active' : 'created',
          });
        } catch (e) {
          reject(new Error('Invalid response from Stripe'));
        }
      });
    });

    request.on('error', (err) => reject(err));
    request.write(params.toString());
    request.end();
  });
}

function createUpiLink({ amount, currency, description, customerName }) {
  const upiId = config.merchantId; // merchantId stores UPI ID for UPI provider
  const url = `upi://pay?pa=${encodeURIComponent(upiId)}&pn=${encodeURIComponent(customerName || '')}&am=${amount}&cu=${currency || 'INR'}&tn=${encodeURIComponent(description || 'Payment')}`;
  return {
    url,
    id: `upi-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    amount,
    status: 'created',
  };
}

function checkRazorpayStatus(paymentId) {
  return new Promise((resolve, reject) => {
    const request = net.request({
      method: 'GET',
      url: `https://api.razorpay.com/v1/payment_links/${paymentId}`,
      headers: {
        'Authorization': 'Basic ' + Buffer.from(`${config.apiKey}:${config.merchantId}`).toString('base64'),
      },
    });

    let body = '';
    request.on('response', (response) => {
      response.on('data', (chunk) => { body += chunk.toString(); });
      response.on('end', () => {
        try {
          const data = JSON.parse(body);
          resolve(data.status || 'unknown');
        } catch (e) {
          resolve('unknown');
        }
      });
    });

    request.on('error', () => resolve('unknown'));
    request.end();
  });
}

function checkStripeStatus(paymentId) {
  return new Promise((resolve, reject) => {
    const request = net.request({
      method: 'GET',
      url: `https://api.stripe.com/v1/payment_links/${paymentId}`,
      headers: {
        'Authorization': `Bearer ${config.apiKey}`,
      },
    });

    let body = '';
    request.on('response', (response) => {
      response.on('data', (chunk) => { body += chunk.toString(); });
      response.on('end', () => {
        try {
          const data = JSON.parse(body);
          resolve(data.active ? 'active' : 'inactive');
        } catch (e) {
          resolve('unknown');
        }
      });
    });

    request.on('error', () => resolve('unknown'));
    request.end();
  });
}

function loadConfig() {
  try {
    if (fs.existsSync(configPath)) {
      config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    }
  } catch (e) {
    config = null;
  }
}

function saveConfig() {
  try {
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf8');
  } catch (e) {
    console.error('Failed to save payment config:', e);
  }
}

function loadHistory() {
  try {
    if (fs.existsSync(historyPath)) {
      history = JSON.parse(fs.readFileSync(historyPath, 'utf8'));
    }
  } catch (e) {
    history = [];
  }
}

function saveHistory() {
  try {
    fs.writeFileSync(historyPath, JSON.stringify(history, null, 2), 'utf8');
  } catch (e) {
    console.error('Failed to save payment history:', e);
  }
}

module.exports = { initPaymentCollection };
