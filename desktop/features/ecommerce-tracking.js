// E-commerce Order Tracking: automated order updates via WhatsApp
// Supports order lifecycle from confirmed through delivered/cancelled

const path = require('path');
const fs = require('fs');

let ordersPath;
let orders = [];
let getViewsRef = null;
let getActiveAccountIdRef = null;

const STATUS_MESSAGES = {
  confirmed: (o) =>
    `Hi ${o.customerName}! Your order #${o.orderId} is confirmed. Total: ${o.currency || 'INR'}${o.total}. We'll notify you when it ships!`,
  shipped: (o) =>
    `Your order #${o.orderId} has been shipped! Tracking: ${o.trackingNumber || 'N/A'}. Track at: ${getTrackingUrl(o)}`,
  out_for_delivery: (o) =>
    `Your order #${o.orderId} is out for delivery! Expected today.`,
  delivered: (o) =>
    `Your order #${o.orderId} has been delivered! Thank you for your purchase.`,
  cancelled: (o) =>
    `Your order #${o.orderId} has been cancelled. Refund will be processed in 5-7 days.`,
};

function getTrackingUrl(order) {
  const carrier = (order.carrier || '').toLowerCase();
  const tracking = order.trackingNumber || '';
  if (carrier.includes('delhivery')) return `https://www.delhivery.com/track/package/${tracking}`;
  if (carrier.includes('bluedart')) return `https://www.bluedart.com/tracking/${tracking}`;
  if (carrier.includes('dtdc')) return `https://www.dtdc.in/tracking/${tracking}`;
  if (carrier.includes('fedex')) return `https://www.fedex.com/fedextrack/?trknbr=${tracking}`;
  return `https://track.aftership.com/${tracking}`;
}

function initEcommerceTracking({ app, ipcMain, getMainWindow, getViews, getActiveAccountId }) {
  ordersPath = path.join(app.getPath('userData'), 'orders.json');
  getViewsRef = getViews;
  getActiveAccountIdRef = getActiveAccountId;

  loadOrders();

  ipcMain.handle('get-orders', (_event, { status } = {}) => {
    if (status) {
      return orders.filter((o) => o.status === status);
    }
    return orders;
  });

  ipcMain.on('create-order', async (_event, order) => {
    order.id = `ord-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    order.orderId = order.orderId || `ORD-${Date.now().toString().slice(-8)}`;
    order.status = order.status || 'confirmed';
    order.currency = order.currency || 'INR';
    order.statusHistory = [{ status: order.status, timestamp: new Date().toISOString() }];
    order.createdAt = new Date().toISOString();
    orders.push(order);
    saveOrders();

    // Auto-send confirmation
    if (order.customerPhone && order.accountId) {
      const msg = STATUS_MESSAGES.confirmed(order);
      await sendWhatsAppMessage(order.accountId, order.customerPhone, msg);
    }

    const win = getMainWindow();
    if (win && !win.isDestroyed()) {
      win.webContents.send('orders-updated', orders);
    }
  });

  ipcMain.on('update-order-status', async (_event, { orderId, status, trackingNumber }) => {
    const order = orders.find((o) => o.orderId === orderId || o.id === orderId);
    if (!order) return;

    order.status = status;
    if (trackingNumber) order.trackingNumber = trackingNumber;
    if (!order.statusHistory) order.statusHistory = [];
    order.statusHistory.push({ status, timestamp: new Date().toISOString() });
    saveOrders();

    // Auto-send status update
    const msgFn = STATUS_MESSAGES[status];
    if (msgFn && order.customerPhone && order.accountId) {
      const msg = msgFn(order);
      await sendWhatsAppMessage(order.accountId, order.customerPhone, msg);
    }

    const win = getMainWindow();
    if (win && !win.isDestroyed()) {
      win.webContents.send('orders-updated', orders);
    }
  });

  ipcMain.on('import-orders-csv', (_event, { csvText }) => {
    try {
      const lines = csvText.trim().split('\n');
      if (lines.length < 2) return;

      const headers = lines[0].split(',').map((h) => h.trim().toLowerCase());
      const imported = [];

      for (let i = 1; i < lines.length; i++) {
        const values = parseCSVLine(lines[i]);
        if (values.length < headers.length) continue;

        const row = {};
        headers.forEach((h, idx) => { row[h] = values[idx]; });

        const order = {
          id: `ord-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          orderId: row.orderid || row.order_id || `ORD-${Date.now().toString().slice(-8)}-${i}`,
          customerName: row.customername || row.customer_name || row.name || '',
          customerPhone: row.customerphone || row.customer_phone || row.phone || '',
          accountId: row.accountid || row.account_id || '',
          status: row.status || 'confirmed',
          trackingNumber: row.trackingnumber || row.tracking_number || row.tracking || '',
          carrier: row.carrier || '',
          items: row.items || '',
          total: parseFloat(row.total || '0'),
          currency: row.currency || 'INR',
          statusHistory: [{ status: row.status || 'confirmed', timestamp: new Date().toISOString() }],
          createdAt: new Date().toISOString(),
        };

        orders.push(order);
        imported.push(order);
      }

      saveOrders();
      const win = getMainWindow();
      if (win && !win.isDestroyed()) {
        win.webContents.send('orders-updated', orders);
        win.webContents.send('orders-imported', { count: imported.length });
      }
    } catch (err) {
      console.error('[ecommerce-tracking] CSV import error:', err.message);
    }
  });

  ipcMain.handle('get-order-stats', () => {
    const byStatus = {};
    let totalRevenue = 0;
    for (const order of orders) {
      byStatus[order.status] = (byStatus[order.status] || 0) + 1;
      if (order.status !== 'cancelled') {
        totalRevenue += order.total || 0;
      }
    }
    return {
      totalOrders: orders.length,
      byStatus,
      totalRevenue,
      currency: orders.length > 0 ? (orders[0].currency || 'INR') : 'INR',
    };
  });

  ipcMain.on('send-order-update', async (_event, { orderId }) => {
    const order = orders.find((o) => o.orderId === orderId || o.id === orderId);
    if (!order) return;

    const msgFn = STATUS_MESSAGES[order.status];
    if (msgFn && order.customerPhone && order.accountId) {
      const msg = msgFn(order);
      await sendWhatsAppMessage(order.accountId, order.customerPhone, msg);
    }
  });
}

function loadOrders() {
  try {
    if (fs.existsSync(ordersPath)) {
      orders = JSON.parse(fs.readFileSync(ordersPath, 'utf-8'));
    }
  } catch (err) {
    console.error('[ecommerce-tracking] Failed to load orders:', err.message);
    orders = [];
  }
}

function saveOrders() {
  try {
    fs.writeFileSync(ordersPath, JSON.stringify(orders, null, 2));
  } catch (err) {
    console.error('[ecommerce-tracking] Failed to save orders:', err.message);
  }
}

function parseCSVLine(line) {
  const values = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      inQuotes = !inQuotes;
    } else if (ch === ',' && !inQuotes) {
      values.push(current.trim());
      current = '';
    } else {
      current += ch;
    }
  }
  values.push(current.trim());
  return values;
}

async function sendWhatsAppMessage(accountId, phone, message) {
  const views = getViewsRef ? getViewsRef() : {};
  if (!views[accountId]) return;

  try {
    // Search for contact
    await views[accountId].webContents.executeJavaScript(`
      (function() {
        const searchBox = document.querySelector('div[contenteditable="true"][data-tab="3"]');
        if (searchBox) {
          searchBox.focus();
          document.execCommand('selectAll');
          document.execCommand('insertText', false, ${JSON.stringify(phone)});
        }
      })();
    `);

    await new Promise((r) => setTimeout(r, 2000));

    // Click the matching contact
    await views[accountId].webContents.executeJavaScript(`
      (function() {
        const results = document.querySelectorAll('span[title]');
        for (const r of results) {
          if (r.title && r.title.includes(${JSON.stringify(phone)})) {
            r.click();
            return true;
          }
        }
        // Try clicking the first search result
        const firstResult = document.querySelector('[data-testid="cell-frame-container"]');
        if (firstResult) firstResult.click();
        return false;
      })();
    `);

    await new Promise((r) => setTimeout(r, 1000));

    // Type and send message
    await views[accountId].webContents.executeJavaScript(`
      (function() {
        const editableDiv = document.querySelector('div[contenteditable="true"][data-tab="10"]');
        if (!editableDiv) return false;
        editableDiv.focus();
        document.execCommand('insertText', false, ${JSON.stringify(message)});
        setTimeout(() => {
          const sendBtn = document.querySelector('button[data-tab="11"]') || document.querySelector('span[data-icon="send"]');
          if (sendBtn) sendBtn.click();
        }, 300);
        return true;
      })();
    `);
  } catch (err) {
    console.error('[ecommerce-tracking] Failed to send WhatsApp message:', err.message);
  }
}

module.exports = { initEcommerceTracking };
