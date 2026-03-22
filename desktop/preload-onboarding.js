const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('hub', {
  finishOnboarding: () => ipcRenderer.send('finish-onboarding'),
});
