const fs = require('fs');
const path = require('path');

function initWhiteLabel({ app, ipcMain, getMainWindow, getViews, getActiveAccountId, getAccounts }) {
  const configPath = path.join(app.getPath('userData'), 'brand-config.json');

  const defaultConfig = {
    enabled: false,
    companyName: 'SupaMsg',
    logoPath: '',
    accentColor: '#25D366',
    headerBg: '#075E54',
    sidebarBg: '#111B21',
    customCss: '',
    hideSupaMsgBranding: false,
    customDomain: '',
    supportEmail: '',
  };

  let config = { ...defaultConfig };

  // --- Persistence ---

  function loadConfig() {
    try {
      if (fs.existsSync(configPath)) {
        const saved = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
        config = { ...defaultConfig, ...saved };
      }
    } catch (err) {
      console.error('[white-label] Failed to load config:', err);
    }
  }

  function saveConfig() {
    try {
      fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf-8');
    } catch (err) {
      console.error('[white-label] Failed to save config:', err);
    }
  }

  // --- Branding Injection ---

  function buildBrandingCss() {
    let css = '';

    css += `:root {
      --accent-color: ${config.accentColor};
      --header-bg: ${config.headerBg};
      --sidebar-bg: ${config.sidebarBg};
    }`;

    if (config.hideSupaMsgBranding) {
      css += `
      [data-supamsg-branding], .supamsg-branding, .powered-by-supamsg {
        display: none !important;
      }`;
    }

    if (config.customCss) {
      css += '\n' + config.customCss;
    }

    return css;
  }

  function buildBrandingJs() {
    let js = '';

    if (config.companyName && config.companyName !== 'SupaMsg') {
      const escaped = config.companyName.replace(/'/g, "\\'").replace(/\\/g, '\\\\');
      js += `
      (function() {
        var walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, null, false);
        while (walker.nextNode()) {
          if (walker.currentNode.nodeValue.includes('SupaMsg')) {
            walker.currentNode.nodeValue = walker.currentNode.nodeValue.replace(/SupaMsg/g, '${escaped}');
          }
        }
      })();`;
    }

    if (config.logoPath) {
      const logoDataUrl = getLogoDataUrl();
      if (logoDataUrl) {
        js += `
        (function() {
          var logos = document.querySelectorAll('[data-supamsg-logo], .supamsg-logo, .app-logo');
          logos.forEach(function(el) {
            if (el.tagName === 'IMG') {
              el.src = '${logoDataUrl}';
            }
          });
        })();`;
      }
    }

    return js;
  }

  function getLogoDataUrl() {
    try {
      if (!config.logoPath || !fs.existsSync(config.logoPath)) return null;
      const ext = path.extname(config.logoPath).toLowerCase().replace('.', '');
      const mime = ext === 'svg' ? 'image/svg+xml' : `image/${ext === 'jpg' ? 'jpeg' : ext}`;
      const data = fs.readFileSync(config.logoPath).toString('base64');
      return `data:${mime};base64,${data}`;
    } catch {
      return null;
    }
  }

  function applyBranding() {
    if (!config.enabled) return;

    const win = getMainWindow();
    if (!win || !win.webContents) return;

    const css = buildBrandingCss();
    const js = buildBrandingJs();

    win.webContents.insertCSS(css).catch((err) => {
      console.error('[white-label] Failed to insert CSS:', err);
    });

    if (js) {
      win.webContents.executeJavaScript(js).catch((err) => {
        console.error('[white-label] Failed to execute branding JS:', err);
      });
    }
  }

  // --- IPC Handlers ---

  ipcMain.handle('get-brand-config', () => {
    return { ...config };
  });

  ipcMain.on('save-brand-config', (event, newConfig) => {
    config = { ...defaultConfig, ...newConfig };
    saveConfig();
    applyBranding();
  });

  ipcMain.on('apply-branding', () => {
    applyBranding();
  });

  ipcMain.on('reset-branding', () => {
    config = { ...defaultConfig };
    saveConfig();
    const win = getMainWindow();
    if (win && win.webContents) {
      win.webContents.reload();
    }
  });

  ipcMain.on('set-custom-logo', (event, { logoPath }) => {
    try {
      if (!logoPath || !fs.existsSync(logoPath)) return;
      const ext = path.extname(logoPath);
      const destPath = path.join(app.getPath('userData'), `custom-logo${ext}`);
      fs.copyFileSync(logoPath, destPath);
      config.logoPath = destPath;
      saveConfig();
      applyBranding();
    } catch (err) {
      console.error('[white-label] Failed to set custom logo:', err);
    }
  });

  ipcMain.handle('export-brand-config', () => {
    return JSON.stringify(config, null, 2);
  });

  ipcMain.on('import-brand-config', (event, { config: importedConfig }) => {
    config = { ...defaultConfig, ...importedConfig };
    saveConfig();
    applyBranding();
  });

  // --- Init ---

  loadConfig();

  const win = getMainWindow();
  if (win && win.webContents) {
    if (win.webContents.isLoading()) {
      win.webContents.once('did-finish-load', () => applyBranding());
    } else {
      applyBranding();
    }
  }
}

module.exports = { initWhiteLabel };
