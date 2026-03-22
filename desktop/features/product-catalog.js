// WhatsApp Product Catalog — manage and share products in chats
// Stores products locally, supports CSV import and in-chat sharing

const path = require('path');
const fs = require('fs');

let catalogPath;
let products = [];

function initProductCatalog({ app, ipcMain, getMainWindow, getViews, getActiveAccountId }) {
  catalogPath = path.join(app.getPath('userData'), 'product-catalog.json');
  loadProducts();

  ipcMain.handle('get-products', () => {
    return products;
  });

  ipcMain.on('save-product', (_event, product) => {
    if (product.id) {
      const idx = products.findIndex((p) => p.id === product.id);
      if (idx >= 0) {
        products[idx] = { ...products[idx], ...product, updatedAt: new Date().toISOString() };
      } else {
        product.id = generateId();
        product.createdAt = new Date().toISOString();
        products.push(product);
      }
    } else {
      product.id = generateId();
      product.createdAt = new Date().toISOString();
      products.push(product);
    }
    saveProducts();
    broadcastProducts(getMainWindow());
  });

  ipcMain.on('delete-product', (_event, { productId }) => {
    products = products.filter((p) => p.id !== productId);
    saveProducts();
    broadcastProducts(getMainWindow());
  });

  ipcMain.handle('get-categories', () => {
    const categories = [...new Set(products.map((p) => p.category).filter(Boolean))];
    return categories.sort();
  });

  ipcMain.on('send-product', async (_event, { accountId, contactName, productId }) => {
    const product = products.find((p) => p.id === productId);
    if (!product) return;

    const message = formatProductMessage(product);
    await sendMessageToContact(accountId, contactName, message, getViews, getActiveAccountId);
  });

  ipcMain.on('send-catalog', async (_event, { accountId, contactName, productIds }) => {
    const selectedProducts = productIds
      .map((id) => products.find((p) => p.id === id))
      .filter(Boolean);

    if (selectedProducts.length === 0) return;

    const messages = selectedProducts.map(formatProductMessage);
    const fullMessage = messages.join('\\n---\\n');
    await sendMessageToContact(accountId, contactName, fullMessage, getViews, getActiveAccountId);
  });

  ipcMain.handle('search-products', (_event, { query }) => {
    if (!query) return products;
    const lower = query.toLowerCase();
    return products.filter((p) =>
      (p.name && p.name.toLowerCase().includes(lower)) ||
      (p.description && p.description.toLowerCase().includes(lower)) ||
      (p.sku && p.sku.toLowerCase().includes(lower))
    );
  });

  ipcMain.on('import-products-csv', (_event, { csvText }) => {
    try {
      const lines = csvText.split('\n').filter((l) => l.trim());
      if (lines.length < 2) return; // Need header + at least one row

      const header = lines[0].split(',').map((h) => h.trim().toLowerCase());
      const nameIdx = header.indexOf('name');
      const descIdx = header.indexOf('description');
      const priceIdx = header.indexOf('price');
      const currencyIdx = header.indexOf('currency');
      const categoryIdx = header.indexOf('category');

      if (nameIdx === -1) return; // Name column required

      let imported = 0;
      for (let i = 1; i < lines.length; i++) {
        const cols = parseCSVLine(lines[i]);
        if (!cols[nameIdx]) continue;

        const product = {
          id: generateId(),
          name: cols[nameIdx] || '',
          description: descIdx >= 0 ? (cols[descIdx] || '') : '',
          price: priceIdx >= 0 ? parseFloat(cols[priceIdx]) || 0 : 0,
          currency: currencyIdx >= 0 ? (cols[currencyIdx] || 'INR') : 'INR',
          category: categoryIdx >= 0 ? (cols[categoryIdx] || '') : '',
          imageUrl: '',
          inStock: true,
          sku: '',
          createdAt: new Date().toISOString(),
        };
        products.push(product);
        imported++;
      }

      if (imported > 0) {
        saveProducts();
        broadcastProducts(getMainWindow());
      }

      const mainWindow = getMainWindow();
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('products-imported', { count: imported });
      }
    } catch (e) {
      console.error('Failed to import CSV:', e);
    }
  });
}

function formatProductMessage(product) {
  let msg = `*${product.name}*`;
  if (product.description) msg += `\n${product.description}`;
  if (product.price) msg += `\nPrice: ${product.currency || 'INR'} ${product.price}`;
  if (product.imageUrl) msg += `\n${product.imageUrl}`;
  return msg;
}

async function sendMessageToContact(accountId, contactName, message, getViews, getActiveAccountId) {
  try {
    const views = getViews();
    const activeId = accountId || getActiveAccountId();
    const view = views[activeId];
    if (!view || view.webContents.isDestroyed()) return;

    const contact = contactName.replace(/'/g, "\\'");
    const msg = message.replace(/'/g, "\\'").replace(/\n/g, '\\n');

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
        document.execCommand('insertText', false, '${msg}');
        await new Promise(r => setTimeout(r, 300));
        const sendBtn = document.querySelector('span[data-icon="send"]');
        if (sendBtn) sendBtn.click();
      })();
    `);
  } catch (e) {
    console.error('Failed to send product message:', e);
  }
}

function parseCSVLine(line) {
  const result = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      inQuotes = !inQuotes;
    } else if (ch === ',' && !inQuotes) {
      result.push(current.trim());
      current = '';
    } else {
      current += ch;
    }
  }
  result.push(current.trim());
  return result;
}

function generateId() {
  return `prod-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
}

function loadProducts() {
  try {
    if (fs.existsSync(catalogPath)) {
      products = JSON.parse(fs.readFileSync(catalogPath, 'utf8'));
    }
  } catch (e) {
    products = [];
  }
}

function saveProducts() {
  try {
    fs.writeFileSync(catalogPath, JSON.stringify(products, null, 2), 'utf8');
  } catch (e) {
    console.error('Failed to save product catalog:', e);
  }
}

function broadcastProducts(mainWindow) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('products-updated', products);
  }
}

module.exports = { initProductCatalog };
