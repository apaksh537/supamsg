const { BrowserWindow, ipcMain } = require('electron');
const path = require('path');

let mainWindow;
let openPanels = {}; // name -> BrowserWindow

const PANEL_CONFIGS = {
  schedule: { width: 440, height: 520, title: 'Schedule Message' },
  templates: { width: 420, height: 500, title: 'Quick Replies' },
  ai: { width: 440, height: 500, title: 'AI Helper' },
  broadcast: { width: 480, height: 540, title: 'Broadcast' },
  dashboard: { width: 560, height: 500, title: 'Dashboard' },
  settings: { width: 440, height: 600, title: 'Settings' },
  'add-account': { width: 400, height: 480, title: 'Add Account' },
  upgrade: { width: 520, height: 500, title: 'Upgrade' },
  'connect-phone': { width: 440, height: 600, title: 'Settings', file: 'settings' },
  'command-palette': { width: 500, height: 400, title: 'Search' },
};

function initPanelManager({ getMainWindow }) {
  mainWindow = getMainWindow;

  ipcMain.on('open-panel', (_event, panelName) => {
    openPanel(panelName);
  });

  ipcMain.on('close-panel', (_event, panelName) => {
    closePanel(panelName);
  });
}

function openPanel(name) {
  // Focus existing panel of same type
  if (openPanels[name]) {
    openPanels[name].focus();
    return;
  }

  const config = PANEL_CONFIGS[name];
  if (!config) return;

  const parent = mainWindow();
  const panelWin = new BrowserWindow({
    width: config.width,
    height: config.height,
    parent: parent,
    modal: false,
    show: false,
    resizable: false,
    minimizable: false,
    maximizable: false,
    titleBarStyle: 'hidden',
    trafficLightPosition: { x: -20, y: -20 }, // Hide native traffic lights (moved offscreen)
    backgroundColor: '#FFFFFF',
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  const fileName = config.file || name;
  panelWin.loadFile(path.join(__dirname, '..', 'panels', `${fileName}.html`));

  panelWin.once('ready-to-show', () => {
    panelWin.show();
  });

  panelWin.on('closed', () => {
    delete openPanels[name];
  });

  openPanels[name] = panelWin;
}

function closePanel(name) {
  if (openPanels[name]) {
    openPanels[name].close();
    delete openPanels[name];
  }
}

function closeAllPanels() {
  Object.keys(openPanels).forEach((name) => {
    if (openPanels[name]) {
      openPanels[name].close();
    }
  });
  openPanels = {};
}

module.exports = { initPanelManager, closeAllPanels };
