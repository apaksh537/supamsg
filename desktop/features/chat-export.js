// Chat Export: export current conversation to text file
// Scrapes visible messages from WhatsApp Web DOM

const path = require('path');
const { dialog } = require('electron');

function initChatExport({ ipcMain, getMainWindow, getViews, getActiveAccountId, accounts }) {

  ipcMain.handle('export-chat', async (_event, { format = 'text', accountId } = {}) => {
    const targetId = accountId || getActiveAccountId();
    const views = getViews();
    if (!targetId || !views[targetId]) {
      return { success: false, error: 'No active account' };
    }

    const view = views[targetId];

    try {
      // Scrape messages from the DOM
      const chatData = await view.webContents.executeJavaScript(`
        (function() {
          const messages = [];
          const chatName = document.querySelector('header [data-testid="conversation-info-header-chat-title"]')?.textContent ||
                           document.querySelector('header span[title]')?.getAttribute('title') ||
                           'Unknown Chat';

          // Get all message rows
          const rows = document.querySelectorAll('[data-testid="msg-container"], .message-in, .message-out');

          rows.forEach(row => {
            const isOutgoing = row.classList.contains('message-out') ||
                               row.querySelector('[data-testid="msg-dblcheck"]') !== null ||
                               row.querySelector('[data-testid="msg-check"]') !== null;

            const textEl = row.querySelector('[data-testid="msg-text"], .selectable-text');
            const text = textEl?.innerText || '';

            const timeEl = row.querySelector('[data-testid="msg-meta"] span, .msg-time');
            const time = timeEl?.textContent || '';

            const senderEl = row.querySelector('[data-testid="msg-author"]');
            const sender = senderEl?.textContent || (isOutgoing ? 'You' : chatName);

            if (text.trim()) {
              messages.push({ sender, text: text.trim(), time, isOutgoing });
            }
          });

          return { chatName, messages, exportedAt: new Date().toISOString() };
        })();
      `);

      if (!chatData || chatData.messages.length === 0) {
        return { success: false, error: 'No messages found in visible chat. Make sure a chat is open.' };
      }

      // Format content
      let content;
      const account = accounts.find((a) => a.id === targetId);
      const accountName = account?.name || 'WhatsApp';
      const header = `Chat Export: ${chatData.chatName}\nAccount: ${accountName}\nExported: ${new Date().toLocaleString()}\nMessages: ${chatData.messages.length}\n${'─'.repeat(50)}\n\n`;

      if (format === 'csv') {
        content = 'Time,Sender,Message\n' +
          chatData.messages.map((m) =>
            `"${m.time}","${m.sender}","${m.text.replace(/"/g, '""')}"`
          ).join('\n');
      } else {
        content = header + chatData.messages.map((m) =>
          `[${m.time}] ${m.sender}: ${m.text}`
        ).join('\n\n');
      }

      // Show save dialog
      const mainWindow = getMainWindow();
      const ext = format === 'csv' ? 'csv' : 'txt';
      const safeName = chatData.chatName.replace(/[^a-zA-Z0-9 ]/g, '').trim();

      const result = await dialog.showSaveDialog(mainWindow, {
        title: 'Export Chat',
        defaultPath: path.join(
          require('electron').app.getPath('downloads'),
          `${safeName} - ${accountName} - ${new Date().toISOString().split('T')[0]}.${ext}`
        ),
        filters: [
          { name: format === 'csv' ? 'CSV' : 'Text', extensions: [ext] },
          { name: 'All Files', extensions: ['*'] },
        ],
      });

      if (result.canceled) return { success: false, error: 'Cancelled' };

      require('fs').writeFileSync(result.filePath, content, 'utf8');
      return { success: true, path: result.filePath, messageCount: chatData.messages.length };

    } catch (err) {
      return { success: false, error: err.message };
    }
  });
}

module.exports = { initChatExport };
