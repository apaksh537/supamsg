// This preload runs inside each WhatsApp Web BrowserView
// It listens for notification messages posted by our injected script
const { ipcRenderer } = require('electron');

window.addEventListener('message', (event) => {
  if (event.data?.type === 'wa-notification') {
    ipcRenderer.sendToHost('wa-notification', {
      title: event.data.title,
      body: event.data.body,
    });
  }

  // Forward WhatsApp warning signals to the main process
  if (event.data?.type === 'supamsg-whatsapp-warning' && event.data.payload) {
    ipcRenderer.sendToHost('supamsg-whatsapp-warning', event.data.payload);
  }
});
